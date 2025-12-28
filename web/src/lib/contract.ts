import { ethers } from "ethers";
import { CONTRACT_ADDRESS, RPC_URL } from "./env";

const certificateRegistryAbi = [
  "event CertificateIssued(bytes32 indexed certificateId,address indexed issuer,bytes32 docHash,string storageURI,uint64 issuedAt,bytes16 salt)",
  "event CertificateRevoked(bytes32 indexed certificateId,address indexed issuer,string reason,uint64 revokedAt)",
  "function issueCertificate(bytes32 certificateId,bytes32 docHash,string storageURI,address issuer,uint64 issuedAt,bytes16 salt,bytes issuerSignature)",
  "function revokeCertificate(bytes32 certificateId,string reason,bytes issuerSignature)",
  "function getCertificate(bytes32 certificateId) view returns (tuple(bytes32 docHash,string storageURI,address issuer,uint64 issuedAt,uint8 status,string revokeReason,uint64 revokedAt,bytes issuerSignature,bytes16 salt,bytes revokeSignature))",
  "function certificateStatus(bytes32 certificateId) view returns (uint8)",
  "function getIssuers() view returns (address[])",
  "function issuerUpdateThreshold() view returns (uint256)",
  "function nextIssuerUpdateProposalId() view returns (uint256)",
  "function issuerUpdateProposals(uint256) view returns (uint8 action,address issuer,address newIssuer,uint32 approvals,bool executed,uint64 createdAt)",
  "function hasApprovedIssuerUpdate(uint256,address) view returns (bool)",
  "function addIssuer(address issuer)",
  "function removeIssuer(address issuer)",
  "function proposeAddIssuer(address newIssuer) returns (uint256)",
  "function proposeRotateIssuer(address issuer,address newIssuer) returns (uint256)",
  "function approveIssuerUpdate(uint256 proposalId)",
  "function executeIssuerUpdate(uint256 proposalId)",
  "function setIssuerUpdateThreshold(uint256 threshold)",
];

export function getProvider() {
  if (!RPC_URL) throw new Error("Missing RPC_URL");
  return new ethers.JsonRpcProvider(RPC_URL);
}

export function getCertificateRegistry(signerOrProvider?: ethers.Signer | ethers.Provider) {
  const provider = signerOrProvider || getProvider();
  return new ethers.Contract(CONTRACT_ADDRESS, certificateRegistryAbi, provider);
}

export type CertificateStruct = {
  docHash: string;
  storageURI: string;
  issuer: string;
  issuedAt: bigint;
  status: number;
  revokeReason: string;
  revokedAt: bigint;
  issuerSignature: string;
  salt: string;
  revokeSignature: string;
};
