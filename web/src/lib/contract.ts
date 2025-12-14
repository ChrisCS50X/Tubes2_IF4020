import { ethers } from "ethers";
import artifact from "./abi/CertificateRegistry.json";
import { CONTRACT_ADDRESS, RPC_URL } from "./env";

type Artifact = { abi: any };
const certificateRegistryAbi = (artifact as Artifact).abi;

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
};
