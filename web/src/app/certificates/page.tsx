"use client";

import { useEffect, useMemo, useState } from "react";
import { getCertificateRegistry, getProvider } from "@/lib/contract";
import { CONTRACT_ADDRESS, DEPLOY_BLOCK, DEPLOY_TX_HASH } from "@/lib/env";

const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

type IssuedCertificate = {
  certificateId: string;
  issuer: string;
  docHash: string;
  storageURI: string;
  issuedAt: number;
  txHash: string;
  status: number;
  statusLabel: string;
  revokeReason: string;
  revokedAt: number;
};

type LoadState = "idle" | "loading" | "loaded" | "error";

export default function CertificatesPage() {
  const [items, setItems] = useState<IssuedCertificate[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked">("all");

  const loadIssued = async () => {
    setState("loading");
    setError(null);
    try {
      if (!CONTRACT_ADDRESS) {
        throw new Error("Missing contract address configuration.");
      }

      const provider = getProvider();
      const contract = getCertificateRegistry(provider);
      const filter = contract.filters.CertificateIssued();
      const latestBlock = await provider.getBlockNumber();
      const rangeSize = 10;

      let startBlock = DEPLOY_BLOCK;
      if (!startBlock && DEPLOY_TX_HASH) {
        const receipt = await provider.getTransactionReceipt(DEPLOY_TX_HASH);
        startBlock = receipt?.blockNumber ?? 0;
      }
      if (!startBlock) {
        startBlock = Math.max(0, latestBlock - (rangeSize - 1));
      }

      const logs: any[] = [];
      for (let from = startBlock; from <= latestBlock; from += rangeSize) {
        const to = Math.min(from + rangeSize - 1, latestBlock);
        const batch = await contract.queryFilter(filter, from, to);
        logs.push(...batch);
      }

      const results = await Promise.all(
        logs.map(async (log) => {
          const args: any = log.args;
          if (!args) return null;
          const certificateId = args.certificateId as string;
          const cert = await contract.getCertificate(certificateId);
          const statusNum = Number(cert.status);
          const statusLabel = statusNum === 1 ? "Active" : statusNum === 2 ? "Revoked" : "Unknown";

          return {
            certificateId,
            issuer: args.issuer as string,
            docHash: args.docHash as string,
            storageURI: args.storageURI as string,
            issuedAt: Number(args.issuedAt),
            txHash: log.transactionHash,
            status: statusNum,
            statusLabel,
            revokeReason: cert.revokeReason || "",
            revokedAt: Number(cert.revokedAt || 0),
          } as IssuedCertificate;
        })
      );

      const filtered = results.filter((item): item is IssuedCertificate => Boolean(item));
      filtered.sort((a, b) => b.issuedAt - a.issuedAt);
      setItems(filtered);
      setState("loaded");
    } catch (e: any) {
      setError(e?.message || "Failed to load certificates.");
      setState("error");
    }
  };

  useEffect(() => {
    loadIssued();
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === "active" && item.status !== 1) return false;
      if (statusFilter === "revoked" && item.status !== 2) return false;
      if (!q) return true;
      return (
        item.certificateId.toLowerCase().includes(q) ||
        item.issuer.toLowerCase().includes(q)
      );
    });
  }, [items, query, statusFilter]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-white">Issued Certificates</h1>
          <p className="text-slate-400">
            On-chain history of issued certificates and their current status.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button
            onClick={loadIssued}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800"
            disabled={state === "loading"}
          >
            {state === "loading" ? "Loading..." : "Refresh"}
          </button>
          {!DEPLOY_BLOCK && !DEPLOY_TX_HASH && (
            <div className="text-xs text-amber-400">
              Showing latest 10 blocks only. Set `NEXT_PUBLIC_DEPLOY_BLOCK` or `NEXT_PUBLIC_DEPLOY_TX_HASH` to load full history.
            </div>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by certificate ID or issuer"
            className="flex-1 rounded-lg border border-slate-600 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder-slate-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "revoked")}
            className="rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>

        {state === "error" && (
          <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {state !== "error" && (
          <div className="space-y-4">
            {filteredItems.length === 0 ? (
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-400">
                No certificates found.
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={`${item.certificateId}-${item.txHash}`}
                  className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-emerald-400">
                        {item.statusLabel}
                      </div>
                      <div className="mt-2 text-xs text-slate-400">Certificate ID</div>
                      <div className="break-all text-sm text-white">{item.certificateId}</div>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>Issued at</div>
                      <div className="text-sm text-slate-200">{formatTimestamp(item.issuedAt)}</div>
                      {item.revokedAt ? (
                        <div className="mt-2">
                          <div>Revoked at</div>
                          <div className="text-sm text-rose-300">
                            {formatTimestamp(item.revokedAt)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-slate-400">Issuer</div>
                      <div className="break-all text-sm text-slate-200">{item.issuer}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Document Hash</div>
                      <div className="break-all text-sm text-slate-200">{item.docHash}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Storage URI</div>
                      <div className="break-all text-sm text-slate-200">{item.storageURI}</div>
                    </div>
                    {item.revokeReason ? (
                      <div>
                        <div className="text-xs text-slate-400">Revoke Reason</div>
                        <div className="text-sm text-rose-300">{item.revokeReason}</div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3 text-xs">
                    <a
                      href={`https://sepolia.etherscan.io/tx/${item.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-slate-600 px-3 py-1 text-slate-200 hover:border-emerald-500 hover:text-emerald-400"
                    >
                      View Tx
                    </a>
                    {item.storageURI ? (
                      <a
                        href={resolveStorageUrl(item.storageURI)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-slate-600 px-3 py-1 text-slate-200 hover:border-blue-500 hover:text-blue-400"
                      >
                        View Encrypted File
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function formatTimestamp(seconds: number): string {
  if (!seconds) return "-";
  const date = new Date(seconds * 1000);
  return date.toISOString();
}

function resolveStorageUrl(storageURI: string): string {
  if (storageURI.startsWith("ipfs://")) {
    return `${IPFS_GATEWAY}${storageURI.slice("ipfs://".length)}`;
  }
  return storageURI;
}
