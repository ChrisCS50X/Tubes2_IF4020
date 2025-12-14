import { randomBytes } from "crypto";

export function generateNonce(): string {
  // 128-bit random, hex string
  return randomBytes(16).toString("hex");
}

export function expiryMs(minutes: number): number {
  return Date.now() + minutes * 60 * 1000;
}
