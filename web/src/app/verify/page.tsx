"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import type { PDFFont, PDFPage } from "pdf-lib";
import { ethers } from "ethers";
import type { Interface, LogDescription, TransactionReceipt } from "ethers";
import QRCode from "qrcode";
import { decryptAesGcm, importAesKeyBase64, EncryptedPayload } from "@/lib/crypto/aes";
import { sha256 } from "@/lib/crypto/hash";
import { getCertificateRegistry, getProvider } from "@/lib/contract";
import { CONTRACT_ADDRESS } from "@/lib/env";
import { createIssueTypedData } from "@/lib/eip712";

const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

type VerifyStatus = "idle" | "verifying" | "success" | "error";

type VerifyForm = {
  file: string;
  key: string;
  tx: string;
};

type VerifyResult = {
  certificateId: string;
  issuer: string;
  issuedAt: number;
  status: number;
  statusLabel: string;
  revokeReason: string;
  storageURI: string;
  docHash: string;
  onChainHash: string;
  txHash: string;
  shareUrl: string;
  fileUrl: string;
  storageMatch: boolean;
};

type EncryptedEnvelope = EncryptedPayload & {
  mimeType?: string;
  fileName?: string;
};

function VerifyCertificatePageInner() {
  const searchParams = useSearchParams();
  const [form, setForm] = useState<VerifyForm>({ file: "", key: "", tx: "" });
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [autoStart, setAutoStart] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const fileParam = searchParams.get("file") || searchParams.get("url") || "";
    const cidParam = searchParams.get("cid") || "";
    const keyParam = searchParams.get("key") || searchParams.get("k") || "";
    const txParam = searchParams.get("tx") || searchParams.get("transaction") || "";
    const fileValue = fileParam || (cidParam ? `ipfs://${cidParam}` : "");

    if (fileValue || keyParam || txParam) {
      setForm((prev) => ({
        file: fileValue || prev.file,
        key: keyParam || prev.key,
        tx: txParam || prev.tx,
      }));
    }

    if (fileValue && keyParam && txParam) {
      setAutoStart(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (autoStart && status === "idle" && form.file && form.key && form.tx) {
      handleVerify();
      setAutoStart(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, status, form.file, form.key, form.tx]);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleVerify = useCallback(async () => {
    setStatus("verifying");
    setError(null);
    setResult(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    setDownloadName(null);

    try {
      if (!form.file || !form.key || !form.tx) {
        throw new Error("File URL/CID, AES key, and transaction hash are required.");
      }
      if (!CONTRACT_ADDRESS) {
        throw new Error("Missing contract address configuration.");
      }

      const fileUrl = resolveFileUrl(form.file);
      const encryptedEnvelope = await fetchEncryptedPayload(fileUrl);

      const aesKey = await importAesKeyBase64(form.key.trim());
      const decrypted = await decryptAesGcm(aesKey, encryptedEnvelope);
      const docHash = await sha256(decrypted);
      const originalMimeType = encryptedEnvelope.mimeType || "application/pdf";
      const originalFileName = encryptedEnvelope.fileName || "";

      const provider = getProvider();
      const contract = getCertificateRegistry(provider);
      const receipt = await provider.getTransactionReceipt(form.tx.trim());
      if (!receipt) {
        throw new Error("Transaction not found on chain.");
      }

      const issueEvent = extractIssuedEvent(receipt, contract.interface);
      if (!issueEvent) {
        throw new Error("Issue event not found in the transaction.");
      }

      const certificateId = issueEvent.args.certificateId as string;
      const cert = await contract.getCertificate(certificateId);
      const statusNum = Number(cert.status);
      const statusLabel = statusNum === 1 ? "Active" : statusNum === 2 ? "Revoked" : "Unknown";

      if (statusNum !== 1) {
        const reason = cert.revokeReason || "Certificate is not active.";
        throw new Error(`Certificate is ${statusLabel}. Reason: ${reason}`);
      }

      const onChainHash = (cert.docHash as string) || "";
      if (onChainHash.toLowerCase() !== docHash.toLowerCase()) {
        throw new Error("Document hash mismatch. The certificate may be tampered.");
      }

      const issuerSignature = (cert.issuerSignature as string) || "";
      if (!issuerSignature || issuerSignature === "0x") {
        throw new Error("Issuer signature missing on-chain.");
      }
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      const issueTypedData = createIssueTypedData({
        certificateId,
        docHash: onChainHash,
        storageURI: cert.storageURI as string,
        issuer: cert.issuer as string,
        issuedAt: Number(cert.issuedAt),
        chainId,
        salt: cert.salt as string,
      });
      const recoveredIssuer = ethers.verifyTypedData(
        issueTypedData.domain,
        issueTypedData.types,
        issueTypedData.message,
        issuerSignature
      );
      if (recoveredIssuer.toLowerCase() !== (cert.issuer as string).toLowerCase()) {
        throw new Error("Issuer signature verification failed.");
      }

      const baseOrigin =
        origin || (typeof window !== "undefined" ? window.location.origin : "");
      const shareUrl = baseOrigin
        ? buildUnlistedUrl(
            `${baseOrigin}/verify`,
            normalizeShareFile(form.file),
            form.key,
            form.tx
          )
        : "";

      let qrDataUrl: string | null = null;
      if (shareUrl) {
        try {
          qrDataUrl = await QRCode.toDataURL(shareUrl, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 220,
          });
        } catch {
          qrDataUrl = null;
        }
      }

      const output = await buildVerifiedFile(
        decrypted,
        originalMimeType,
        originalFileName,
        certificateId,
        shareUrl || "Verification URL unavailable",
        qrDataUrl || undefined,
        shareUrl || undefined
      );
      const objectUrl = URL.createObjectURL(output.blob);
      setDownloadUrl(objectUrl);
      setDownloadName(output.fileName);

      setResult({
        certificateId,
        issuer: cert.issuer as string,
        issuedAt: Number(cert.issuedAt),
        status: statusNum,
        statusLabel,
        revokeReason: cert.revokeReason || "",
        storageURI: cert.storageURI as string,
        docHash,
        onChainHash,
        txHash: form.tx.trim(),
        shareUrl,
        fileUrl,
        storageMatch: storageMatches(cert.storageURI as string, form.file),
      });
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setError(err?.message || "Verification failed.");
    }
  }, [downloadUrl, form.file, form.key, form.tx, origin]);

  const resetForm = () => {
    setForm({ file: "", key: "", tx: "" });
    setStatus("idle");
    setResult(null);
    setError(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    setDownloadName(null);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">Verify Ijazah</h1>
          <p className="text-slate-400">
            Decrypt the certificate, verify its hash on-chain, and download the verified PDF.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
            <h2 className="mb-6 text-xl font-semibold text-white">Verification Input</h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerify();
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Encrypted File URL or IPFS CID *
                </label>
                <input
                  type="text"
                  name="file"
                  value={form.file}
                  onChange={handleInputChange}
                  required
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="ipfs://... or https://... or CID"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  AES Key (base64url) *
                </label>
                <input
                  type="text"
                  name="key"
                  value={form.key}
                  onChange={handleInputChange}
                  required
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="Key from issuer"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Transaction Hash *
                </label>
                <input
                  type="text"
                  name="tx"
                  value={form.tx}
                  onChange={handleInputChange}
                  required
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="0x..."
                />
              </div>

              <button
                type="submit"
                disabled={status === "verifying"}
                className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 font-semibold text-white shadow-lg transition-all hover:from-emerald-600 hover:to-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "verifying" ? "Verifying..." : "Verify Certificate"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
            <h2 className="mb-6 text-xl font-semibold text-white">Result</h2>

            {status === "idle" && (
              <div className="flex h-full items-center justify-center text-center text-slate-500">
                <div>
                  <p>Provide the encrypted file, AES key, and transaction hash to verify.</p>
                </div>
              </div>
            )}

            {status === "verifying" && (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-4 border-slate-600 border-t-emerald-500" />
                  <p className="text-lg font-medium text-white">Verifying certificate...</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Downloading, decrypting, and checking on-chain data
                  </p>
                </div>
              </div>
            )}

            {status === "success" && result && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-700 bg-emerald-900/30 p-4 text-emerald-300">
                  Certificate verified successfully.
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Certificate ID
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-emerald-400">
                      {result.certificateId}
                    </code>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Issuer
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-blue-300">{result.issuer}</code>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Issued At
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-xs text-slate-300">
                    {formatTimestamp(result.issuedAt)}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Status
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-xs text-slate-300">
                    {result.statusLabel}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    On-chain Hash
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-purple-300">{result.onChainHash}</code>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Local Hash
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-purple-300">{result.docHash}</code>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Storage URI (On-chain)
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-slate-300">{result.storageURI}</code>
                  </div>
                  {!result.storageMatch && (
                    <p className="mt-1 text-xs text-amber-400">
                      Warning: input file does not match on-chain storage URI.
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Transaction Hash
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-blue-300">{result.txHash}</code>
                  </div>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${result.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-blue-400 hover:underline"
                  >
                    View on Etherscan
                  </a>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Verification URL
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-emerald-300">
                      {result.shareUrl}
                    </code>
                  </div>
                </div>

                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download={downloadName || `certificate-${result.certificateId}.pdf`}
                    className="block w-full rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-500"
                  >
                    Download Verified File
                  </a>
                )}

                <button
                  onClick={resetForm}
                  className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800"
                >
                  Verify Another Certificate
                </button>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-red-300">
                  {error}
                </div>
                <button
                  onClick={() => setStatus("idle")}
                  className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/40 p-6 backdrop-blur">
          <h3 className="mb-4 text-lg font-semibold text-white">How it works</h3>
          <ol className="space-y-2 text-sm text-slate-400">
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">1.</span>
              <span>Download encrypted payload from off-chain storage</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">2.</span>
              <span>Decrypt PDF with AES key from the unlisted URL</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">3.</span>
              <span>Hash the decrypted PDF with SHA-256</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">4.</span>
              <span>Fetch metadata from blockchain using the transaction hash</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">5.</span>
              <span>Compare hashes and download the verified PDF</span>
            </li>
          </ol>
        </div>
      </div>
    </main>
  );
}

export default function VerifyCertificatePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
          <div className="mx-auto max-w-xl rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
            <div className="flex items-center gap-3 text-slate-200">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-500" />
              <span>Loading verifier...</span>
            </div>
          </div>
        </main>
      }
    >
      <VerifyCertificatePageInner />
    </Suspense>
  );
}

function normalizeShareFile(file: string): string {
  const trimmed = file.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ipfs://")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `ipfs://${trimmed}`;
}

function resolveFileUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ipfs://")) {
    return `${IPFS_GATEWAY}${trimmed.slice("ipfs://".length)}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `${IPFS_GATEWAY}${trimmed}`;
}

async function fetchEncryptedPayload(fileUrl: string): Promise<EncryptedEnvelope> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error("Failed to download encrypted file.");
  }
  const json = await response.json();
  if (!json || typeof json !== "object") {
    throw new Error("Encrypted payload is invalid.");
  }
  const { iv, tag, data, mimeType, fileName } = json as Partial<EncryptedEnvelope>;
  if (!iv || !tag || !data) {
    throw new Error("Encrypted payload is missing fields.");
  }
  return { iv, tag, data, mimeType, fileName } as EncryptedEnvelope;
}

function extractIssuedEvent(receipt: TransactionReceipt, iface: Interface): LogDescription | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "CertificateIssued") {
        return parsed;
      }
    } catch {
      // ignore non-matching logs
    }
  }
  return null;
}

function buildUnlistedUrl(baseUrl: string, file: string, key: string, tx: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("file", file);
  url.searchParams.set("key", key);
  url.searchParams.set("tx", tx);
  return url.toString();
}

function formatTimestamp(seconds: number): string {
  if (!seconds) return "-";
  const date = new Date(seconds * 1000);
  return date.toISOString();
}

function storageMatches(storageURI: string, inputFile: string): boolean {
  const storageCid = extractIpfsCid(storageURI);
  const inputCid = extractIpfsCid(inputFile);
  if (!storageCid || !inputCid) return true;
  return storageCid === inputCid;
}

function extractIpfsCid(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ipfs://")) return trimmed.slice("ipfs://".length);
  const match = trimmed.match(/\/ipfs\/([^/?#]+)/);
  if (match?.[1]) return match[1];
  if (!trimmed.includes("/") && !trimmed.includes(":")) return trimmed;
  return "";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function buildVerifiedFile(
  fileBytes: ArrayBuffer,
  mimeType: string,
  originalFileName: string,
  certificateId: string,
  url: string,
  qrDataUrl?: string,
  linkUrl?: string
): Promise<{ blob: Blob; fileName: string }> {
  const resolvedMime = resolveMimeType(mimeType, originalFileName);
  const fileName = buildFileName(originalFileName, certificateId, resolvedMime);

  if (resolvedMime === "application/pdf") {
    const pdfWithUrl = await embedUrlInPdf(fileBytes, url, qrDataUrl, linkUrl);
    const pdfBuffer = toArrayBuffer(pdfWithUrl);
    return { blob: new Blob([pdfBuffer], { type: "application/pdf" }), fileName };
  }

  if (resolvedMime.startsWith("text/")) {
    const textWithUrl = embedUrlInText(fileBytes, url);
    return { blob: new Blob([textWithUrl], { type: "text/plain" }), fileName };
  }

  if (resolvedMime.startsWith("image/")) {
    const blob = await embedUrlInImage(fileBytes, resolvedMime, url, qrDataUrl);
    return { blob, fileName };
  }

  throw new Error("Unsupported file type for verification.");
}

async function embedUrlInPdf(
  pdfBytes: ArrayBuffer,
  url: string,
  qrDataUrl?: string,
  linkUrl?: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error("PDF has no pages.");
  }
  const page = pages[0];
  const { width } = page.getSize();
  const fontSize = 8;
  const lineHeight = fontSize + 2;
  const marginX = 36;
  const marginY = 72;
  const qrSize = 72;
  const qrPadding = 12;
  const maxWidth = width - marginX * 2 - (qrDataUrl ? qrSize + qrPadding : 0);

  const urlLines = wrapText(url, font, fontSize, maxWidth);
  const lines = ["URL Ijazah:", ...urlLines];

  for (let i = 0; i < lines.length; i += 1) {
    page.drawText(lines[i], {
      x: marginX,
      y: marginY + i * lineHeight,
      size: fontSize,
    });
  }

  if (linkUrl) {
    const textHeight = lines.length * lineHeight;
    addLinkAnnotation(page, linkUrl, {
      x: marginX,
      y: marginY - 2,
      width: maxWidth,
      height: textHeight + 4,
    });
  }

  if (qrDataUrl) {
    const qrBytes = await fetch(qrDataUrl).then((res) => res.arrayBuffer());
    const qrImage = await pdfDoc.embedPng(qrBytes);
    const qrX = width - marginX - qrSize;
    page.drawImage(qrImage, {
      x: qrX,
      y: marginY,
      width: qrSize,
      height: qrSize,
    });

    if (linkUrl) {
      addLinkAnnotation(page, linkUrl, {
        x: qrX,
        y: marginY,
        width: qrSize,
        height: qrSize,
      });
    }
  }

  return pdfDoc.save();
}

function embedUrlInText(fileBytes: ArrayBuffer, url: string): string {
  const text = new TextDecoder().decode(new Uint8Array(fileBytes));
  return `${text}\n\nURL Ijazah: ${url}\n`;
}

async function embedUrlInImage(
  fileBytes: ArrayBuffer,
  mimeType: string,
  urlText: string,
  qrDataUrl?: string
): Promise<Blob> {
  const inputBlob = new Blob([fileBytes], { type: mimeType });
  const objectUrl = URL.createObjectURL(inputBlob);

  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not supported.");
    }

    ctx.drawImage(image, 0, 0);

    const padding = Math.max(12, Math.floor(image.width * 0.02));
    const fontSize = Math.max(12, Math.floor(image.width * 0.03));
    ctx.font = `${fontSize}px sans-serif`;

    const maxWidth = image.width - padding * 2;
    const lines = wrapCanvasText(ctx, `URL Ijazah: ${urlText}`, maxWidth);
    const lineHeight = fontSize + 4;
    const blockHeight = lines.length * lineHeight + padding;
    const rectY = Math.max(0, image.height - blockHeight - padding);

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, rectY, image.width, blockHeight + padding);

    ctx.fillStyle = "#ffffff";
    lines.forEach((line, index) => {
      ctx.fillText(line, padding, rectY + padding + lineHeight * (index + 0.8));
    });

    if (qrDataUrl) {
      try {
        const qrImage = await loadImage(qrDataUrl);
        const qrSize = Math.min(140, Math.floor(image.width * 0.2));
        const qrX = image.width - qrSize - padding;
        const qrY = Math.max(padding, rectY - qrSize - padding);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
      } catch {
        // Ignore QR failures for image output
      }
    }

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to export image."));
            return;
          }
          resolve(blob);
        },
        mimeType === "image/jpeg" ? "image/jpeg" : "image/png"
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image."));
    img.src = src;
  });
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const testLine = current ? `${current} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth) {
      current = testLine;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }

    let segment = "";
    for (const char of word) {
      const testSegment = segment + char;
      if (ctx.measureText(testSegment).width > maxWidth && segment) {
        lines.push(segment);
        segment = char;
      } else {
        segment = testSegment;
      }
    }
    current = segment;
  }

  if (current) lines.push(current);
  return lines;
}

function normalizeMimeType(mimeType: string): string {
  const normalized = (mimeType || "").split(";")[0]?.trim();
  return normalized || "application/pdf";
}

function resolveMimeType(mimeType: string, fileName: string): string {
  const normalized = normalizeMimeType(mimeType);
  if (normalized !== "application/octet-stream") return normalized;
  const ext = fileName?.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "txt") return "text/plain";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return normalized;
}

function buildFileName(
  originalFileName: string,
  certificateId: string,
  mimeType: string
): string {
  const trimmed = originalFileName?.trim();
  const ext = extensionFromMime(mimeType);
  if (trimmed) {
    if (trimmed.includes(".") || !ext) return trimmed;
    return `${trimmed}.${ext}`;
  }
  if (!ext) return `certificate-${certificateId}`;
  return `certificate-${certificateId}.${ext}`;
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/plain") return "txt";
  if (mimeType.startsWith("text/")) return "txt";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return "";
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    const test = current + char;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function addLinkAnnotation(
  page: PDFPage,
  url: string,
  rect: { x: number; y: number; width: number; height: number }
) {
  const { x, y, width, height } = rect;
  const context = page.doc.context;
  const annotation = context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: context.obj({
      S: PDFName.of("URI"),
      URI: PDFString.of(url),
    }),
  });
  const annotationRef = context.register(annotation);
  page.node.addAnnot(annotationRef);
}
