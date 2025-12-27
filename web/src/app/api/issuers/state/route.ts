import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";
import { getCertificateRegistry, getProvider } from "@/lib/contract";
import { CONTRACT_ADDRESS } from "@/lib/env";

function actionLabel(action: number) {
  if (action === 1) return "Add";
  if (action === 2) return "Rotate";
  return "None";
}

export type IssuerUpdateProposalDto = {
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

export async function GET(request: Request) {
  try {
    const response = new NextResponse(null);
    const session = await getIronSession<AuthSession>(request, response, sessionOptions);
    const viewer = session.walletAddress || null;

    if (!CONTRACT_ADDRESS) {
      return NextResponse.json(
        { success: false, error: "NEXT_PUBLIC_CONTRACT_ADDRESS is missing" },
        { status: 500, headers: response.headers }
      );
    }

    const provider = getProvider();
    const code = await provider.getCode(CONTRACT_ADDRESS);
    if (!code || code === "0x") {
      return NextResponse.json(
        {
          success: false,
          error:
            `No contract code at ${CONTRACT_ADDRESS}. Check NEXT_PUBLIC_CHAIN_ID / NEXT_PUBLIC_ALCHEMY_RPC_URL, or update NEXT_PUBLIC_CONTRACT_ADDRESS to the latest deployed CertificateRegistry.`,
        },
        { status: 500, headers: response.headers }
      );
    }

    const contract = getCertificateRegistry();

    let issuers: string[];
    try {
      issuers = await contract.getIssuers();
    } catch (e: any) {
      const message = e?.shortMessage || e?.message || "Unknown error";
      return NextResponse.json(
        {
          success: false,
          error:
            `Failed to call getIssuers() on ${CONTRACT_ADDRESS}. This usually means you are pointing to an older deployment that doesn't include issuer enumeration / multi-sig issuer updates. Redeploy the updated contract and set NEXT_PUBLIC_CONTRACT_ADDRESS to the new address. Details: ${message}`,
        },
        { status: 500, headers: response.headers }
      );
    }

    const [threshold, nextId] = await Promise.all([
      contract.issuerUpdateThreshold(),
      contract.nextIssuerUpdateProposalId(),
    ]);

    const proposals: IssuerUpdateProposalDto[] = [];
    const lastId = Number(nextId) - 1;

    for (let id = 1; id <= lastId; id++) {
      const p = await contract.issuerUpdateProposals(id);

      // p: [action, issuer, newIssuer, approvals, executed, createdAt]
      const action = Number(p[0]);
      const issuer = String(p[1]);
      const newIssuer = String(p[2]);
      const approvals = (p[3] as bigint).toString();
      const executed = Boolean(p[4]);
      const createdAt = (p[5] as bigint).toString();

      let viewerHasApproved = false;
      if (viewer) {
        try {
          viewerHasApproved = await contract.hasApprovedIssuerUpdate(id, viewer);
        } catch {
          viewerHasApproved = false;
        }
      }

      proposals.push({
        id: String(id),
        action,
        actionLabel: actionLabel(action),
        issuer,
        newIssuer,
        approvals,
        executed,
        createdAt,
        viewerHasApproved,
      });
    }

    return NextResponse.json(
      {
        success: true,
        viewer,
        issuers,
        threshold: (threshold as bigint).toString(),
        nextProposalId: (nextId as bigint).toString(),
        proposals,
      },
      { headers: response.headers }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load issuer state" },
      { status: 500 }
    );
  }
}
