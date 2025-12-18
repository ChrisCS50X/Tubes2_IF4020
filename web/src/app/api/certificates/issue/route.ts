import { NextRequest, NextResponse } from "next/server";
import { generateCertificatePDF, CertificateData } from "@/lib/pdf/generateCertificate";
import { sha256 } from "@/lib/crypto/hash";
import { encryptAesGcm, generateAesKey, exportAesKeyBase64 } from "@/lib/crypto/aes";
import { pinFile } from "@/lib/ipfs/pinata";
import { createIssueTypedData, generateCertificateId, generateSalt, signTypedData } from "@/lib/eip712";
import { getCertificateRegistry } from "@/lib/contract";
import { ethers } from "ethers";
import { CHAIN_ID } from "@/lib/env";

/**
 * Convert Node.js Buffer to ArrayBuffer
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export type IssueCertificateRequest = {
  certificateData: CertificateData;
  issuerPrivateKey: string; // For signing (in production, use secure key management)
};

export type IssueCertificateResponse = {
  success: boolean;
  certificateId?: string;
  transactionHash?: string;
  ipfsCid?: string;
  encryptionKey?: string;
  error?: string;
};

/**
 * POST /api/certificates/issue
 * 
 * Issue a new certificate:
 * 1. Generate PDF from certificate data
 * 2. Hash the PDF (SHA-256)
 * 3. Encrypt the PDF with AES-GCM
 * 4. Upload encrypted PDF to IPFS
 * 5. Sign with EIP-712
 * 6. Submit to blockchain
 */
export async function POST(request: NextRequest) {
  try {
    const body: IssueCertificateRequest = await request.json();
    const { certificateData, issuerPrivateKey } = body;

    // Validate input
    if (!certificateData || !issuerPrivateKey) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // 1. Generate PDF
    console.log("📄 Generating PDF certificate...");
    const pdfBuffer = await generateCertificatePDF(certificateData);

    // 2. Hash the PDF (SHA-256)
    console.log("🔐 Hashing PDF...");
    const pdfArrayBuffer = bufferToArrayBuffer(pdfBuffer);
    const docHash = await sha256(pdfArrayBuffer);
    console.log("Document hash:", docHash);

    // 3. Encrypt the PDF with AES-GCM
    console.log("🔒 Encrypting PDF...");
    const aesKey = await generateAesKey();
    const encryptedPayload = await encryptAesGcm(aesKey, pdfArrayBuffer);
    const encryptionKey = await exportAesKeyBase64(aesKey);

    // Serialize encrypted payload to JSON
    const encryptedJson = JSON.stringify(encryptedPayload);
    const encryptedBuffer = Buffer.from(encryptedJson, "utf-8");

    // 4. Upload encrypted PDF to IPFS
    console.log("☁️ Uploading to IPFS...");
    const ipfsResult = await pinFile(
      `certificate-${Date.now()}.json`,
      encryptedBuffer,
      "application/json"
    );
    console.log("IPFS CID:", ipfsResult.cid);

    const storageURI = `ipfs://${ipfsResult.cid}`;

    // 5. Prepare blockchain submission
    console.log("⛓️ Preparing blockchain transaction...");
    
    // Create wallet from private key
    const wallet = new ethers.Wallet(issuerPrivateKey);
    const issuerAddress = wallet.address;

    // Generate salt and timestamp
    const salt = generateSalt();
    const issuedAt = Math.floor(Date.now() / 1000);
    const chainId = CHAIN_ID; // Already a number from env.ts

    // Generate certificate ID
    const certificateId = generateCertificateId(docHash, salt, issuerAddress, chainId, issuedAt);
    console.log("Certificate ID:", certificateId);

    // Create typed data for EIP-712
    const typedData = createIssueTypedData({
      certificateId,
      docHash,
      storageURI,
      issuer: issuerAddress,
      issuedAt,
      chainId,
      salt,
    });

    // Sign typed data
    const signature = await signTypedData(wallet, typedData);
    console.log("Signature:", signature);

    // 6. Submit to blockchain
    console.log("📤 Submitting to blockchain...");
    
    // Get provider and create signer
    const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL);
    const signer = wallet.connect(provider);

    // Get contract instance
    const contract = getCertificateRegistry(signer);

    // Call issueCertificate function
    const tx = await contract.issueCertificate(
      certificateId,
      docHash,
      storageURI,
      issuerAddress,
      issuedAt,
      salt,
      signature
    );

    console.log("Transaction sent:", tx.hash);
    console.log("⏳ Waiting for confirmation...");

    // Wait for transaction confirmation
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

    return NextResponse.json({
      success: true,
      certificateId,
      transactionHash: receipt.hash,
      ipfsCid: ipfsResult.cid,
      encryptionKey,
    });

  } catch (error: any) {
    console.error("❌ Error issuing certificate:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Failed to issue certificate" 
      },
      { status: 500 }
    );
  }
}
