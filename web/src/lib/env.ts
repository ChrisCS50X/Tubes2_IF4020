export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 0);
export const RPC_URL = process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL || "";
export const DEPLOY_BLOCK = Number(process.env.NEXT_PUBLIC_DEPLOY_BLOCK || 0);
export const DEPLOY_TX_HASH = process.env.NEXT_PUBLIC_DEPLOY_TX_HASH || "";

export function assertEnv() {
  if (!CONTRACT_ADDRESS) throw new Error("NEXT_PUBLIC_CONTRACT_ADDRESS is missing");
  if (!CHAIN_ID) throw new Error("NEXT_PUBLIC_CHAIN_ID is missing");
  if (!RPC_URL) throw new Error("NEXT_PUBLIC_ALCHEMY_RPC_URL is missing");
}
