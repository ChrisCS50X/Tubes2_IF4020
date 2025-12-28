import { ethers } from "ethers";
import { CHAIN_ID, CONTRACT_ADDRESS } from "./env";

export type IssueTypedData = {
  certificateId: string;
  docHash: string;
  storageURI: string;
  issuer: string;
  issuedAt: number;
  chainId: number;
  salt: string;
};

export type RevokeTypedData = {
  certificateId: string;
  reason: string;
  issuer: string;
  chainId: number;
};

/**
 * Create EIP-712 typed data for issuing a certificate
 */
export function createIssueTypedData(data: IssueTypedData) {
  return {
    domain: {
      name: "CertificateRegistry",
      version: "1",
      chainId: data.chainId,
      verifyingContract: CONTRACT_ADDRESS,
    },
    types: {
      Issue: [
        { name: "certificateId", type: "bytes32" },
        { name: "docHash", type: "bytes32" },
        { name: "storageURI", type: "string" },
        { name: "issuer", type: "address" },
        { name: "issuedAt", type: "uint256" },
        { name: "chainId", type: "uint256" },
        { name: "salt", type: "bytes16" },
      ],
    },
    primaryType: "Issue" as const,
    message: {
      certificateId: data.certificateId,
      docHash: data.docHash,
      storageURI: data.storageURI,
      issuer: data.issuer,
      issuedAt: data.issuedAt,
      chainId: data.chainId,
      salt: data.salt,
    },
  };
}

/**
 * Create EIP-712 typed data for revoking a certificate
 */
export function createRevokeTypedData(data: RevokeTypedData) {
  return {
    domain: {
      name: "CertificateRegistry",
      version: "1",
      chainId: data.chainId,
      verifyingContract: CONTRACT_ADDRESS,
    },
    types: {
      Revoke: [
        { name: "certificateId", type: "bytes32" },
        { name: "reason", type: "string" },
        { name: "issuer", type: "address" },
        { name: "chainId", type: "uint256" },
      ],
    },
    primaryType: "Revoke" as const,
    message: {
      certificateId: data.certificateId,
      reason: data.reason,
      issuer: data.issuer,
      chainId: data.chainId,
    },
  };
}

/**
 * Sign typed data using EIP-712
 * @param signer - ethers Signer (from wallet)
 * @param typedData - EIP-712 typed data
 * @returns signature string
 */
export async function signTypedData(
  signer: ethers.Signer,
  typedData: ReturnType<typeof createIssueTypedData> | ReturnType<typeof createRevokeTypedData>
): Promise<string> {
  const signature = await signer.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message
  );
  return signature;
}

/**
 * Generate certificate ID from parameters
 * certificateId = keccak256(docHash, salt, issuer, chainId, issuedAt)
 */
export function generateCertificateId(
  docHash: string,
  salt: string,
  issuer: string,
  chainId: number,
  issuedAt: number
): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes16", "address", "uint256", "uint256"],
    [docHash, salt, issuer, chainId, issuedAt]
  );
  return ethers.keccak256(encoded);
}

/**
 * Generate random 16-byte salt as bytes16
 */
export function generateSalt(): string {
  const randomBytes = ethers.randomBytes(16);
  return ethers.hexlify(randomBytes);
}
