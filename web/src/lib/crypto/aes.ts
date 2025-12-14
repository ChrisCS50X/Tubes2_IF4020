export type EncryptedPayload = {
  iv: string; // base64url
  tag: string; // base64url
  data: string; // base64url ciphertext
};

export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportAesKeyBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64Url(raw);
}

export async function importAesKeyBase64(keyB64: string): Promise<CryptoKey> {
  const raw = fromBase64Url(keyB64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export async function encryptAesGcm(key: CryptoKey, data: ArrayBuffer): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const { ciphertext, tag } = splitGcmResult(encrypted);
  return {
    iv: toBase64Url(iv.buffer),
    tag: toBase64Url(tag),
    data: toBase64Url(ciphertext),
  };
}

export async function decryptAesGcm(key: CryptoKey, payload: EncryptedPayload): Promise<ArrayBuffer> {
  const iv = fromBase64Url(payload.iv);
  const tag = fromBase64Url(payload.tag);
  const ciphertext = fromBase64Url(payload.data);
  const combined = combineGcmInput(ciphertext, tag);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, combined);
}

function splitGcmResult(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const tagStart = bytes.length - 16; // 128-bit tag
  const ciphertext = bytes.slice(0, tagStart);
  const tag = bytes.slice(tagStart);
  return { ciphertext: ciphertext.buffer, tag: tag.buffer };
}

function combineGcmInput(ciphertext: ArrayBuffer, tag: ArrayBuffer) {
  const c = new Uint8Array(ciphertext);
  const t = new Uint8Array(tag);
  const combined = new Uint8Array(c.length + t.length);
  combined.set(c, 0);
  combined.set(t, c.length);
  return combined.buffer;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): ArrayBuffer {
  const base64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const normalized = base64 + pad;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
