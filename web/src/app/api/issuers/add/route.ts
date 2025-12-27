import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";
import { getCertificateRegistry } from "@/lib/contract";
import { ethers } from "ethers";
import { RPC_URL } from "@/lib/env";

export type ProposeAddIssuerRequest = {
  newIssuer: string;
  adminPrivateKey: string;
};

export async function POST(request: NextRequest) {
  try {
    const response = new NextResponse(null);
    const session = await getIronSession<AuthSession>(request, response, sessionOptions);
    if (!session.authenticated || !session.walletAddress) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: response.headers }
      );
    }

    const body: ProposeAddIssuerRequest = await request.json();
    const { newIssuer, adminPrivateKey } = body;

    if (!newIssuer || !adminPrivateKey) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400, headers: response.headers }
      );
    }

    if (!RPC_URL) {
      return NextResponse.json(
        { success: false, error: "RPC_URL missing" },
        { status: 500, headers: response.headers }
      );
    }

    if (!ethers.isAddress(newIssuer)) {
      return NextResponse.json(
        { success: false, error: "Invalid newIssuer address" },
        { status: 400, headers: response.headers }
      );
    }

    const wallet = new ethers.Wallet(adminPrivateKey);
    if (wallet.address.toLowerCase() !== session.walletAddress.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: "Admin wallet does not match authenticated session" },
        { status: 403, headers: response.headers }
      );
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = wallet.connect(provider);
    const contract = getCertificateRegistry(signer);

    // Bootstrap: if there are zero issuers, allow owner to add the first issuer directly.
    // After that, use the multi-sig proposal flow.
    let issuers: string[] = [];
    try {
      issuers = await contract.getIssuers();
    } catch {
      issuers = [];
    }

    if (issuers.length === 0) {
      const tx = await contract.addIssuer(newIssuer);
      const receipt = await tx.wait();
      return NextResponse.json(
        {
          success: true,
          mode: "direct",
          transactionHash: receipt.hash,
        },
        { headers: response.headers }
      );
    }

    // Get proposalId via static call first (tx return values are not available directly)
    const proposalId = await contract.proposeAddIssuer.staticCall(newIssuer);

    const tx = await contract.proposeAddIssuer(newIssuer);
    const receipt = await tx.wait();

    return NextResponse.json(
      {
        success: true,
        mode: "proposal",
        proposalId: proposalId.toString(),
        transactionHash: receipt.hash,
      },
      { headers: response.headers }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to propose add issuer" },
      { status: 500 }
    );
  }
}
