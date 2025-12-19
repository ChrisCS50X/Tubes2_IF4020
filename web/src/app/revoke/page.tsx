"use client";

import { useEffect, useState } from "react";

type FormState = {
  status: "idle" | "revoking" | "success" | "error";
  transactionHash?: string;
  error?: string;
};

export default function RevokeCertificatePage() {
  const [certificateId, setCertificateId] = useState("");
  const [reason, setReason] = useState("");
  const [issuerPrivateKey, setIssuerPrivateKey] = useState("");
  const [formState, setFormState] = useState<FormState>({ status: "idle" });
  const [sessionStatus, setSessionStatus] = useState<
    "checking" | "authenticated" | "unauthenticated"
  >("checking");
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!certificateId.trim()) {
      alert("Certificate ID is required!");
      return;
    }
    if (!reason.trim()) {
      alert("Revoke reason is required!");
      return;
    }
    if (!issuerPrivateKey.trim()) {
      alert("Private key is required!");
      return;
    }

    try {
      setFormState({ status: "revoking" });
      const response = await fetch("/api/certificates/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          certificateId: certificateId.trim(),
          reason: reason.trim(),
          issuerPrivateKey: issuerPrivateKey.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to revoke certificate");
      }

      setFormState({
        status: "success",
        transactionHash: result.transactionHash,
      });
    } catch (error: any) {
      setFormState({
        status: "error",
        error: error.message || "An error occurred",
      });
    }
  };

  const resetForm = () => {
    setCertificateId("");
    setReason("");
    setIssuerPrivateKey("");
    setFormState({ status: "idle" });
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
          <h1 className="mb-2 text-2xl font-semibold text-white">Revoke Ijazah</h1>
          <p className="text-sm text-slate-400">
            Please connect your wallet on the home page to access the revoke form.
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
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">Revoke Ijazah</h1>
          <p className="text-slate-400">Revoke certificates that are no longer valid.</p>
          {sessionAddress && (
            <p className="mt-2 text-xs text-slate-500">Authenticated as {sessionAddress}</p>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
            <h2 className="mb-6 text-xl font-semibold text-white">Revoke Form</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Certificate ID *
                </label>
                <input
                  type="text"
                  value={certificateId}
                  onChange={(e) => setCertificateId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="0x..."
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Revoke Reason *
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="e.g., Issued in error"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Issuer Private Key * (For Demo Only)
                </label>
                <input
                  type="password"
                  value={issuerPrivateKey}
                  onChange={(e) => setIssuerPrivateKey(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  placeholder="0x..."
                />
                <p className="mt-1 text-xs text-slate-500">
                  In production, use secure key management (HSM, KMS).
                </p>
              </div>

              <button
                type="submit"
                disabled={formState.status === "revoking"}
                className="w-full rounded-lg bg-gradient-to-r from-rose-500 to-red-500 px-6 py-3 font-semibold text-white shadow-lg transition-all hover:from-rose-600 hover:to-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {formState.status === "revoking" ? "Revoking..." : "Revoke Certificate"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
            <h2 className="mb-6 text-xl font-semibold text-white">Result</h2>

            {formState.status === "idle" && (
              <div className="flex h-full items-center justify-center text-center text-slate-500">
                <p>Fill the form to revoke a certificate.</p>
              </div>
            )}

            {formState.status === "revoking" && (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-4 border-slate-600 border-t-rose-500" />
                  <p className="text-lg font-medium text-white">Submitting revoke transaction...</p>
                </div>
              </div>
            )}

            {formState.status === "success" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-700 bg-emerald-900/30 p-4 text-emerald-300">
                  Certificate revoked successfully.
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-400">
                    Transaction Hash
                  </label>
                  <div className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2">
                    <code className="break-all text-xs text-blue-300">
                      {formState.transactionHash}
                    </code>
                  </div>
                  {formState.transactionHash && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${formState.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-blue-400 hover:underline"
                    >
                      View on Etherscan
                    </a>
                  )}
                </div>
                <button
                  onClick={resetForm}
                  className="w-full rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800"
                >
                  Revoke Another Certificate
                </button>
              </div>
            )}

            {formState.status === "error" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-red-700 bg-red-900/30 p-4">
                  <div className="text-sm text-red-300">{formState.error}</div>
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
      </div>
    </main>
  );
}
