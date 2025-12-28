"use client";

import { useEffect, useMemo, useState } from "react";
import detectEthereumProvider from "@metamask/detect-provider";
import { ethers } from "ethers";
import { CertificateData, generateCertificatePDF } from "@/lib/pdf/generateCertificate";
import { sha256 } from "@/lib/crypto/hash";
import { encryptAesGcm, exportAesKeyBase64, generateAesKey } from "@/lib/crypto/aes";
import { createIssueTypedData, generateCertificateId, generateSalt, signTypedData } from "@/lib/eip712";
import { getCertificateRegistry } from "@/lib/contract";
import { CHAIN_ID, CONTRACT_ADDRESS } from "@/lib/env";

type FormState = {
  status: "idle" | "generating" | "success" | "error";
  certificateId?: string;
  transactionHash?: string;
  ipfsCid?: string;
  encryptionKey?: string;
  error?: string;
};

export default function IssueCertificatePage() {
  const [formData, setFormData] = useState<CertificateData>({
    studentName: "",
    nim: "",
    program: "",
    faculty: "",
    graduationDate: "",
    gpa: "",
    degree: "",
    universityName: "INSTITUT TEKNOLOGI BANDUNG",
    rectorName: "Prof. Dr. Rektor ITB",
    deanName: "Dr. Dekan STEI",
  });

  const [formState, setFormState] = useState<FormState>({ status: "idle" });
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sessionStatus, setSessionStatus] = useState<
    "checking" | "authenticated" | "unauthenticated"
  >("checking");
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);

  const [origin, setOrigin] = useState("");

  const checkSession = async () => {
    setSessionStatus("checking");
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = await res.json();
      if (json.authenticated) {
        setSessionStatus("authenticated");
        setSessionAddress(json.walletAddress || null);
      } else {
        setSessionStatus("unauthenticated");
        setSessionAddress(null);
      }
    } catch {
      setSessionStatus("unauthenticated");
      setSessionAddress(null);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const verificationUrl = useMemo(() => {
    if (formState.status !== "success") return "";
    if (!origin || !formState.ipfsCid || !formState.encryptionKey || !formState.transactionHash) {
      return "";
    }
    const url = new URL("/verify", origin);
    url.searchParams.set("file", `ipfs://${formState.ipfsCid}`);
    url.searchParams.set("key", formState.encryptionKey);
    url.searchParams.set("tx", formState.transactionHash);
    return url.toString();
  }, [formState.status, formState.ipfsCid, formState.encryptionKey, formState.transactionHash, origin]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadedFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setFormState({ status: "generating" });

      if (!CONTRACT_ADDRESS) {
        throw new Error("Missing contract address configuration.");
      }

      const injectedProvider: any = await detectEthereumProvider();
      if (!injectedProvider) {
        throw new Error("MetaMask not found.");
      }
      await injectedProvider.request({ method: "eth_requestAccounts" });

      const browserProvider = new ethers.BrowserProvider(injectedProvider);
      const signer = await browserProvider.getSigner();
      const signerAddress = await signer.getAddress();
      if (sessionAddress && signerAddress.toLowerCase() !== sessionAddress.toLowerCase()) {
        throw new Error("Connected wallet does not match authenticated session.");
      }

      const network = await browserProvider.getNetwork();
      const chainId = Number(network.chainId);
      if (CHAIN_ID && chainId !== CHAIN_ID) {
        throw new Error(`Wrong network. Please switch to chain ${CHAIN_ID}.`);
      }

      let fileBytes: ArrayBuffer;
      let mimeType = "application/pdf";
      let fileName = "";

      if (uploadedFile) {
        fileBytes = await uploadedFile.arrayBuffer();
        mimeType = uploadedFile.type || "application/octet-stream";
        fileName = uploadedFile.name || `certificate-${Date.now()}`;
      } else {
        fileBytes = await generateCertificatePDF(formData);
        mimeType = "application/pdf";
        fileName = `certificate-${Date.now()}.pdf`;
      }

      const docHash = await sha256(fileBytes);
      const aesKey = await generateAesKey();
      const encryptedPayload = await encryptAesGcm(aesKey, fileBytes);
      const encryptionKey = await exportAesKeyBase64(aesKey);

      const pinResponse = await fetch("/api/certificates/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedPayload: {
            ...encryptedPayload,
            mimeType,
            fileName,
          },
        }),
      });

      const pinResult = await pinResponse.json();
      if (!pinResponse.ok || !pinResult.success) {
        throw new Error(pinResult.error || "Failed to upload encrypted certificate.");
      }

      const storageURI = pinResult.storageURI as string;
      const ipfsCid = pinResult.ipfsCid as string;
      if (!storageURI || !ipfsCid) {
        throw new Error("Invalid IPFS response.");
      }

      const salt = generateSalt();
      const issuedAt = Math.floor(Date.now() / 1000);
      const certificateId = generateCertificateId(docHash, salt, signerAddress, chainId, issuedAt);

      const typedData = createIssueTypedData({
        certificateId,
        docHash,
        storageURI,
        issuer: signerAddress,
        issuedAt,
        chainId,
        salt,
      });
      const signature = await signTypedData(signer, typedData);

      const contract = getCertificateRegistry(signer);
      const tx = await contract.issueCertificate(
        certificateId,
        docHash,
        storageURI,
        signerAddress,
        issuedAt,
        salt,
        signature
      );
      const receipt = await tx.wait();

      setFormState({
        status: "success",
        certificateId,
        transactionHash: receipt.hash,
        ipfsCid,
        encryptionKey,
      });
    } catch (error: any) {
      setFormState({
        status: "error",
        error: error.message || "An error occurred",
      });
    }
  };

  const resetForm = () => {
    setFormState({ status: "idle" });
    setUploadedFile(null);
    setFormData({
      studentName: "",
      nim: "",
      program: "",
      faculty: "",
      graduationDate: "",
      gpa: "",
      degree: "",
      universityName: "INSTITUT TEKNOLOGI BANDUNG",
      rectorName: "Prof. Dr. Rektor ITB",
      deanName: "Dr. Dekan STEI",
    });
  };

  if (sessionStatus === "checking") {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
          <div className="flex items-center gap-3 text-slate-200">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-500" />
            <span>Checking wallet session...</span>
          </div>
        </div>
      </main>
    );
  }

  if (sessionStatus !== "authenticated") {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
          <h1 className="mb-2 text-2xl font-semibold text-white">Issue Ijazah</h1>
          <p className="text-sm text-slate-400">
            Please connect your wallet on the home page to access the issuer form.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="/"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
            >
              Go to Login
            </a>
            <button
              onClick={checkSession}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800"
            >
              Retry Session Check
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">📜 Issue Ijazah</h1>
          <p className="text-slate-400">
            Generate, encrypt, and publish certificate to blockchain
          </p>
          {sessionAddress && (
            <p className="mt-2 text-xs text-slate-500">Authenticated as {sessionAddress}</p>
          )}
        </div>

        {/* Main Content */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Form Section */}
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
            <h2 className="mb-6 text-xl font-semibold text-white">Certificate Information</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Optional File Upload */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Upload Certificate File (PDF/Image/Text)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt"
                  onChange={handleFileChange}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-sm file:text-slate-200"
                />
                <p className="mt-1 text-xs text-slate-500">
                  If a file is uploaded, the form below becomes optional.
                </p>
              </div>

              {/* Student Name */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Student Name *
                </label>
                <input
                  type="text"
                  name="studentName"
                  value={formData.studentName}
                  onChange={handleInputChange}
                  required={!uploadedFile}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="e.g., Budi Santoso"
                />
              </div>

              {/* NIM */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  NIM *
                </label>
                <input
                  type="text"
                  name="nim"
                  value={formData.nim}
                  onChange={handleInputChange}
                  required={!uploadedFile}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="e.g., 13520001"
                />
              </div>

              {/* Program */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Study Program *
                </label>
                <input
                  type="text"
                  name="program"
                  value={formData.program}
                  onChange={handleInputChange}
                  required={!uploadedFile}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="e.g., Teknik Informatika"
                />
              </div>

              {/* Faculty */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Faculty *
                </label>
                <input
                  type="text"
                  name="faculty"
                  value={formData.faculty}
                  onChange={handleInputChange}
                  required={!uploadedFile}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="e.g., Sekolah Teknik Elektro dan Informatika"
                />
              </div>

              {/* Degree */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Degree *
                </label>
                <input
                  type="text"
                  name="degree"
                  value={formData.degree}
                  onChange={handleInputChange}
                  required={!uploadedFile}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="e.g., Komputer"
                />
              </div>

              {/* GPA */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  GPA *
                </label>
                <input
                  type="text"
                  name="gpa"
                  value={formData.gpa}
                  onChange={handleInputChange}
                  required={!uploadedFile}
                  pattern="[0-9]+\.?[0-9]*"
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="e.g., 3.85"
                />
              </div>

              {/* Graduation Date */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Graduation Date *
                </label>
                <input
                  type="date"
                  name="graduationDate"
                  value={formData.graduationDate}
                  onChange={handleInputChange}
                  required={!uploadedFile}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={formState.status === "generating"}
                className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 font-semibold text-white shadow-lg transition-all hover:from-emerald-600 hover:to-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {formState.status === "generating" ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Processing...
                  </span>
                ) : (
                  "🚀 Issue Certificate"
                )}
              </button>
            </form>
          </div>

          {/* Result Section */}
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
            <h2 className="mb-6 text-xl font-semibold text-white">Result</h2>

            {formState.status === "idle" && (
              <div className="flex h-full items-center justify-center text-center text-slate-500">
                <div>
                  <svg
                    className="mx-auto mb-4 h-16 w-16 text-slate-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p>Fill out the form and click "Issue Certificate"</p>
                </div>
              </div>
            )}

            {formState.status === "generating" && (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-4 border-slate-600 border-t-emerald-500" />
                  <p className="text-lg font-medium text-white">Generating certificate...</p>
                  <p className="mt-2 text-sm text-slate-400">
                    Please wait while we process your request
                  </p>
                </div>
              </div>
            )}

            {formState.status === "success" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-emerald-900/30 border border-emerald-700 p-4">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="font-semibold">Certificate issued successfully!</span>
                  </div>
                </div>

                {/* Certificate ID */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Certificate ID
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-emerald-400">
                      {formState.certificateId}
                    </code>
                  </div>
                </div>

                {/* Transaction Hash */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Transaction Hash
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-blue-400">
                      {formState.transactionHash}
                    </code>
                  </div>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${formState.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-blue-400 hover:underline"
                  >
                    View on Etherscan →
                  </a>
                </div>

                {/* IPFS CID */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    IPFS CID
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-purple-400">
                      {formState.ipfsCid}
                    </code>
                  </div>
                  <a
                    href={`https://gateway.pinata.cloud/ipfs/${formState.ipfsCid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-purple-400 hover:underline"
                  >
                    View on IPFS Gateway →
                  </a>
                </div>

                {/* Encryption Key */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Encryption Key
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-amber-400">
                      {formState.encryptionKey}
                    </code>
                  </div>
                  <p className="mt-1 text-xs text-amber-500">
                    ⚠️ Save this key securely! It's needed to decrypt the certificate.
                  </p>
                </div>

                {verificationUrl && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-400">
                      Verification URL
                    </label>
                    <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                      <code className="break-all text-xs text-emerald-400">
                        {verificationUrl}
                      </code>
                    </div>
                    <a
                      href={verificationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-emerald-400 hover:underline"
                    >
                      Open verify page
                    </a>
                  </div>
                )}


                {/* Reset Button */}
                <button
                  onClick={resetForm}
                  className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800"
                >
                  Issue Another Certificate
                </button>
              </div>
            )}

            {formState.status === "error" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-red-700 bg-red-900/30 p-4">
                  <div className="flex items-center gap-2 text-red-400">
                    <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="font-semibold">Error occurred</span>
                  </div>
                  <p className="mt-2 text-sm text-red-300">{formState.error}</p>
                </div>

                <button
                  onClick={() => setFormState({ status: "idle" })}
                  className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/40 p-6 backdrop-blur">
          <h3 className="mb-4 text-lg font-semibold text-white">ℹ️ How it works</h3>
          <ol className="space-y-2 text-sm text-slate-400">
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">1.</span>
              <span>Generate a certificate or upload your own PDF/Image/Text file</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">2.</span>
              <span>Hash the unsigned document using SHA-256</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">3.</span>
              <span>Encrypt the document with AES-256-GCM</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">4.</span>
              <span>Upload encrypted payload to IPFS via Pinata</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">5.</span>
              <span>Sign certificate metadata using wallet (EIP-712)</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 font-bold text-emerald-400">6.</span>
              <span>Submit transaction to blockchain (Ethereum Sepolia)</span>
            </li>
          </ol>
        </div>
      </div>
    </main>
  );
}
