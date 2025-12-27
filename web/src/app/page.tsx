"use client";

import { useState } from "react";
import detectEthereumProvider from "@metamask/detect-provider";
import { loginMessage } from "@/lib/messages";
import { CONTRACT_ADDRESS } from "@/lib/env";

type AuthState = {
  status: "idle" | "connecting" | "authenticated" | "error";
  address?: string;
  error?: string;
};

export default function Home() {
  const [auth, setAuth] = useState<AuthState>({ status: "idle" });

  const handleLogin = async () => {
    try {
      setAuth({ status: "connecting" });
      const provider: any = await detectEthereumProvider();
      if (!provider) throw new Error("MetaMask not found");

      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const address = (accounts[0] as string) || "";
      if (!address) throw new Error("Wallet address missing");

      const nonceRes = await fetch("/api/auth/nonce");
      const nonceJson = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceJson.error || "Failed to get nonce");
      const { nonce } = nonceJson;

      const message = loginMessage(nonce);
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, address],
      });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyJson.error || "Verify failed");

      setAuth({ status: "authenticated", address });
    } catch (err: any) {
      setAuth({ status: "error", error: err?.message || "Unknown error" });
    }
  };

  const handleCheckSession = async () => {
    const res = await fetch("/api/auth/me");
    const json = await res.json();
    if (json.authenticated) {
      setAuth({ status: "authenticated", address: json.walletAddress });
    } else {
      setAuth({ status: "idle" });
    }
  };

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Wallet Auth (Nonce + personal_sign)</h1>
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-col gap-2">
          <button
            onClick={handleLogin}
            className="w-fit rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
            disabled={auth.status === "connecting"}
          >
            {auth.status === "connecting" ? "Connecting..." : "Connect & Verify"}
          </button>
          <button
            onClick={handleCheckSession}
            className="w-fit rounded-md border border-slate-700 px-4 py-2 text-sm hover:border-slate-500"
          >
            Check Session
          </button>
          <div className="text-sm text-slate-200">
            Status: {auth.status}
            {auth.address ? ` | ${auth.address}` : ""}
          </div>
          {auth.error && <div className="text-sm text-red-400">Error: {auth.error}</div>}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <h2 className="mb-4 text-xl font-semibold">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <a
            href="/issue"
            className="group rounded-xl border border-slate-700 bg-slate-900/60 p-6 transition-all hover:border-emerald-500 hover:bg-slate-900"
          >
            <div className="mb-2 text-3xl">📜</div>
            <h3 className="mb-2 text-lg font-semibold text-white group-hover:text-emerald-400">
              Issue Certificate
            </h3>
            <p className="text-sm text-slate-400">
              Generate and publish certificates to blockchain
            </p>
          </a>
          <a
            href="/verify"
            className="group rounded-xl border border-slate-700 bg-slate-900/60 p-6 transition-all hover:border-emerald-500 hover:bg-slate-900"
          >
            <div className="mb-2 text-3xl">🔍</div>
            <h3 className="mb-2 text-lg font-semibold text-white group-hover:text-emerald-400">
              Verify Certificate
            </h3>
            <p className="text-sm text-slate-400">
              Decrypt and verify certificates against blockchain
            </p>
          </a>

          <a
            href="/revoke"
            className="group rounded-xl border border-slate-700 bg-slate-900/60 p-6 transition-all hover:border-rose-500 hover:bg-slate-900"
          >
            <div className="mb-2 text-3xl">X</div>
            <h3 className="mb-2 text-lg font-semibold text-white group-hover:text-rose-400">
              Revoke Certificate
            </h3>
            <p className="text-sm text-slate-400">
              Revoke invalid or withdrawn certificates
            </p>
          </a>

          <a
            href="/issuers"
            className="group rounded-xl border border-slate-700 bg-slate-900/60 p-6 transition-all hover:border-emerald-500 hover:bg-slate-900"
          >
            <div className="mb-2 text-3xl">🔑</div>
            <h3 className="mb-2 text-lg font-semibold text-white group-hover:text-emerald-400">
              Issuer Updates
            </h3>
            <p className="text-sm text-slate-400">
              Multi-sig add / rotate issuers
            </p>
          </a>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-2 text-lg font-semibold">Contract Explorer</h2>
        {CONTRACT_ADDRESS ? (
          <div className="space-y-2 text-sm text-slate-300">
            <div className="break-all">Address: {CONTRACT_ADDRESS}</div>
            <a
              href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-emerald-400 hover:underline"
            >
              View on Etherscan
            </a>
          </div>
        ) : (
          <p className="text-sm text-amber-400">
            Missing `NEXT_PUBLIC_CONTRACT_ADDRESS` in environment.
          </p>
        )}
      </div>
    </main>
  );
}
