import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";
import { getCertificateRegistry } from "@/lib/contract";
import { ethers } from "ethers";
import { RPC_URL } from "@/lib/env";

export type ProposeRotateIssuerRequest = {
  issuer: string;
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

    const body: ProposeRotateIssuerRequest = await request.json();
    const { issuer, newIssuer, adminPrivateKey } = body;

    if (!issuer || !newIssuer || !adminPrivateKey) {
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

    if (!ethers.isAddress(issuer)) {
      return NextResponse.json(
        { success: false, error: "Invalid issuer address" },
        { status: 400, headers: response.headers }
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

    const proposalId = await contract.proposeRotateIssuer.staticCall(issuer, newIssuer);

    const tx = await contract.proposeRotateIssuer(issuer, newIssuer);
    const receipt = await tx.wait();

    return NextResponse.json(
      {
        success: true,
        proposalId: proposalId.toString(),
        transactionHash: receipt.hash,
      },
      { headers: response.headers }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to propose rotate issuer" },
      { status: 500 }
    );
  }
}
