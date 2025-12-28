"use client";

import { useEffect, useState } from "react";
import detectEthereumProvider from "@metamask/detect-provider";
import { ethers } from "ethers";
import { getCertificateRegistry } from "@/lib/contract";
import { CHAIN_ID, CONTRACT_ADDRESS } from "@/lib/env";

type SessionState =
  | { status: "checking" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; walletAddress: string };

type IssuerUpdateProposalDto = {
  id: string;
  action: number;
  actionLabel: string;
  issuer: string;
  newIssuer: string;
  approvals: string;
  executed: boolean;
  createdAt: string;
  viewerHasApproved: boolean;
};

type IssuerStateResponse = {
  success: boolean;
  error?: string;
  viewer: string | null;
  issuers: string[];
  threshold: string;
  nextProposalId: string;
  proposals: IssuerUpdateProposalDto[];
};

export default function IssuersPage() {
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [state, setState] = useState<IssuerStateResponse | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [actionStatus, setActionStatus] = useState<string>("");

  const [newIssuer, setNewIssuer] = useState("");
  const [rotateOldIssuer, setRotateOldIssuer] = useState("");
  const [rotateNewIssuer, setRotateNewIssuer] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [threshold, setThreshold] = useState<number>(1);

  const checkSession = async () => {
    setSession({ status: "checking" });
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = await res.json();
      if (json.authenticated && json.walletAddress) {
        setSession({ status: "authenticated", walletAddress: json.walletAddress });
      } else {
        setSession({ status: "unauthenticated" });
      }
    } catch {
      setSession({ status: "unauthenticated" });
    }
  };

  const refreshState = async () => {
    setLoadingState(true);
    setActionStatus("");
    try {
      const res = await fetch("/api/issuers/state", { cache: "no-store" });
      const json: IssuerStateResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to fetch issuer state");
      }
      setState(json);
      setThreshold(parseInt(json.threshold || "1", 10) || 1);
    } catch (e: any) {
      setActionStatus(e?.message || "Failed to load state");
      setState(null);
    } finally {
      setLoadingState(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    if (session.status === "authenticated") {
      refreshState();
    }
  }, [session.status]);

  const getWalletSigner = async () => {
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

    if (session.status === "authenticated") {
      const sessionAddr = session.walletAddress.toLowerCase();
      if (signerAddress.toLowerCase() !== sessionAddr) {
        throw new Error("Connected wallet does not match authenticated session.");
      }
    }

    const network = await browserProvider.getNetwork();
    const chainId = Number(network.chainId);
    if (CHAIN_ID && chainId !== CHAIN_ID) {
      throw new Error(`Wrong network. Please switch to chain ${CHAIN_ID}.`);
    }

    return signer;
  };

  const handleProposeAdd = async () => {
    try {
      setActionStatus("");
      const trimmed = newIssuer.trim();
      if (!ethers.isAddress(trimmed)) {
        throw new Error("Invalid new issuer address.");
      }

      const signer = await getWalletSigner();
      const contract = getCertificateRegistry(signer);

      const issuers = await contract.getIssuers();
      if (issuers.length === 0) {
        const tx = await contract.addIssuer(trimmed);
        const receipt = await tx.wait();
        setActionStatus(`Added issuer directly. tx=${receipt.hash}`);
      } else {
        const proposalId = await contract.proposeAddIssuer.staticCall(trimmed);
        const tx = await contract.proposeAddIssuer(trimmed);
        const receipt = await tx.wait();
        setActionStatus(`Proposed add issuer. proposalId=${proposalId.toString()}, tx=${receipt.hash}`);
      }

      await refreshState();
    } catch (e: any) {
      setActionStatus(e?.message || "Failed to propose add issuer");
    }
  };

  const handleProposeRotate = async () => {
    try {
      setActionStatus("");
      const oldIssuer = rotateOldIssuer.trim();
      const newIssuerAddress = rotateNewIssuer.trim();
      if (!ethers.isAddress(oldIssuer) || !ethers.isAddress(newIssuerAddress)) {
        throw new Error("Invalid issuer address.");
      }
      if (oldIssuer.toLowerCase() === newIssuerAddress.toLowerCase()) {
        throw new Error("Old issuer and new issuer cannot be the same.");
      }

      const signer = await getWalletSigner();
      const contract = getCertificateRegistry(signer);
      const proposalId = await contract.proposeRotateIssuer.staticCall(oldIssuer, newIssuerAddress);
      const tx = await contract.proposeRotateIssuer(oldIssuer, newIssuerAddress);
      const receipt = await tx.wait();
      setActionStatus(`Proposed rotate issuer. proposalId=${proposalId.toString()}, tx=${receipt.hash}`);
      await refreshState();
    } catch (e: any) {
      setActionStatus(e?.message || "Failed to propose rotate issuer");
    }
  };

  const handleApprove = async () => {
    try {
      setActionStatus("");
      const id = BigInt(proposalId.trim());
      const signer = await getWalletSigner();
      const contract = getCertificateRegistry(signer);
      const tx = await contract.approveIssuerUpdate(id);
      const receipt = await tx.wait();
      setActionStatus(`Approved proposal. tx=${receipt.hash}`);
      await refreshState();
    } catch (e: any) {
      setActionStatus(e?.message || "Failed to approve proposal");
    }
  };

  const handleExecute = async () => {
    try {
      setActionStatus("");
      const id = BigInt(proposalId.trim());
      const signer = await getWalletSigner();
      const contract = getCertificateRegistry(signer);
      const tx = await contract.executeIssuerUpdate(id);
      const receipt = await tx.wait();
      setActionStatus(`Executed proposal. tx=${receipt.hash}`);
      await refreshState();
    } catch (e: any) {
      setActionStatus(e?.message || "Failed to execute proposal");
    }
  };

  const handleSetThreshold = async () => {
    try {
      setActionStatus("");
      if (!Number.isInteger(threshold) || threshold < 1) {
        throw new Error("Threshold must be an integer >= 1.");
      }
      const signer = await getWalletSigner();
      const contract = getCertificateRegistry(signer);
      const tx = await contract.setIssuerUpdateThreshold(threshold);
      const receipt = await tx.wait();
      setActionStatus(`Threshold updated. tx=${receipt.hash}`);
      await refreshState();
    } catch (e: any) {
      setActionStatus(e?.message || "Failed to update threshold");
    }
  };

  if (session.status === "checking") {
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

  if (session.status !== "authenticated") {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
          <h1 className="mb-2 text-2xl font-semibold text-white">Issuer Updates (Multi-sig)</h1>
          <p className="text-sm text-slate-400">Please connect your wallet on the home page first.</p>
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
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">🔑 Issuer Updates (Multi-sig)</h1>
          <p className="text-slate-400">Propose → approve → execute issuer add/rotate</p>
          <p className="mt-2 text-xs text-slate-500">Authenticated as {session.walletAddress}</p>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={refreshState}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800"
            disabled={loadingState}
          >
            {loadingState ? "Refreshing..." : "Refresh"}
          </button>
          {actionStatus && (
            <div className="max-w-3xl rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-200">
              {actionStatus}
            </div>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-semibold text-white">Institution (Owner)</h2>
            <div className="space-y-4">


              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-200">Set Approval Threshold</div>
                <div className="flex flex-wrap gap-3">
                  <input
                    type="number"
                    min={1}
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value || "1", 10) || 1)}
                    className="w-32 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white"
                  />
                  <button
                    onClick={handleSetThreshold}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    Update
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Current threshold: {state?.threshold ?? "-"}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-200">Propose Add Issuer</div>
                <input
                  value={newIssuer}
                  onChange={(e) => setNewIssuer(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500"
                  placeholder="New issuer address (0x...)"
                />
                <div className="mt-3">
                  <button
                    onClick={handleProposeAdd}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    Propose
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-200">Propose Rotate Issuer ("Update Public Key")</div>
                <div className="space-y-2">
                  <input
                    value={rotateOldIssuer}
                    onChange={(e) => setRotateOldIssuer(e.target.value)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500"
                    placeholder="Old issuer address (0x...)"
                  />
                  <input
                    value={rotateNewIssuer}
                    onChange={(e) => setRotateNewIssuer(e.target.value)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500"
                    placeholder="New issuer address (0x...)"
                  />
                </div>
                <div className="mt-3">
                  <button
                    onClick={handleProposeRotate}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    Propose
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-200">Execute Proposal</div>
                <div className="flex flex-wrap gap-3">
                  <input
                    value={proposalId}
                    onChange={(e) => setProposalId(e.target.value)}
                    className="w-40 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500"
                    placeholder="Proposal ID"
                  />
                  <button
                    onClick={handleExecute}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    Execute
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-semibold text-white">Issuer (Approver)</h2>
            <div className="space-y-4">


              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-200">Approve Proposal</div>
                <div className="flex flex-wrap gap-3">
                  <input
                    value={proposalId}
                    onChange={(e) => setProposalId(e.target.value)}
                    className="w-40 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white placeholder-slate-500"
                    placeholder="Proposal ID"
                  />
                  <button
                    onClick={handleApprove}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-200">Current Issuers</div>
                <div className="space-y-2 text-xs text-slate-300">
                  {(state?.issuers || []).length === 0 ? (
                    <div className="text-slate-500">No issuers found.</div>
                  ) : (
                    state?.issuers.map((addr) => (
                      <div key={addr} className="break-all rounded-md border border-slate-800 bg-slate-900/30 p-2">
                        {addr}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-semibold text-white">Proposals</h2>
          {!state ? (
            <div className="text-sm text-slate-400">No data loaded.</div>
          ) : state.proposals.length === 0 ? (
            <div className="text-sm text-slate-400">No proposals yet.</div>
          ) : (
            <div className="space-y-3">
              {state.proposals
                .slice()
                .reverse()
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProposalId(p.id)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/30 p-4 text-left hover:border-slate-600"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-200">
                        #{p.id} — {p.actionLabel}
                      </div>
                      <div className="text-xs text-slate-400">
                        approvals: {p.approvals} | executed: {String(p.executed)} | youApproved: {String(p.viewerHasApproved)}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="text-xs text-slate-300">
                        <div className="text-slate-500">issuer</div>
                        <div className="break-all">{p.issuer}</div>
                      </div>
                      <div className="text-xs text-slate-300">
                        <div className="text-slate-500">newIssuer</div>
                        <div className="break-all">{p.newIssuer}</div>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
