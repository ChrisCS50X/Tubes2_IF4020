import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";
import { getCertificateRegistry } from "@/lib/contract";
import { ethers } from "ethers";
import { RPC_URL } from "@/lib/env";

export type RevokeCertificateRequest = {
  certificateId: string;
  reason: string;
  issuerPrivateKey: string;
};

export async function POST(request: NextRequest) {
  try {
    const response = new NextResponse(null);
    const session = await getIronSession<AuthSession>(request, response, sessionOptions);
    if (!session.authenticated || !session.walletAddress) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: response.headers }
      );
    }

    const body: RevokeCertificateRequest = await request.json();
    const { certificateId, reason, issuerPrivateKey } = body;

    if (!certificateId || !reason || !issuerPrivateKey) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400, headers: response.headers }
      );
    }

    if (!RPC_URL) {
      return NextResponse.json(
        { success: false, error: "RPC_URL missing" },
        { status: 500, headers: response.headers }
      );
    }

    if (!ethers.isHexString(certificateId) || certificateId.length !== 66) {
      return NextResponse.json(
        { success: false, error: "Invalid certificateId format" },
        { status: 400, headers: response.headers }
      );
    }

    const wallet = new ethers.Wallet(issuerPrivateKey);
    const issuerAddress = wallet.address;
    if (issuerAddress.toLowerCase() !== session.walletAddress.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: "Issuer wallet does not match authenticated session" },
        { status: 403, headers: response.headers }
      );
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = wallet.connect(provider);
    const contract = getCertificateRegistry(signer);

    const tx = await contract.revokeCertificate(certificateId, reason);
    const receipt = await tx.wait();

    return NextResponse.json({
      success: true,
      transactionHash: receipt.hash,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to revoke certificate" },
      { status: 500 }
    );
  }
}
