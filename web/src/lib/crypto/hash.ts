export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return bufferToHex(hashBuffer);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
