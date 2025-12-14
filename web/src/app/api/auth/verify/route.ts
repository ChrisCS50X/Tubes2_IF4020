import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";
import { loginMessage } from "@/lib/messages";
import { ethers } from "ethers";

type VerifyBody = {
  address?: string;
  signature?: string;
};

export async function POST(request: Request) {
  // Prepare response to carry Set-Cookie header updates
  const response = new NextResponse(null);
  const session = await getIronSession<AuthSession>(request, response, sessionOptions);

  let body: VerifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: response.headers });
  }

  const { address, signature } = body;
  if (!address || !signature) {
    return NextResponse.json({ error: "address and signature required" }, { status: 400, headers: response.headers });
  }

  if (!session.nonce || !session.nonceExpiresAt) {
    return NextResponse.json({ error: "Nonce missing" }, { status: 400, headers: response.headers });
  }
  if (Date.now() > session.nonceExpiresAt) {
    session.nonce = undefined;
    session.nonceExpiresAt = undefined;
    session.authenticated = false;
    await session.save();
    return NextResponse.json({ error: "Nonce expired" }, { status: 400, headers: response.headers });
  }

  const message = loginMessage(session.nonce);
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400, headers: response.headers });
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: "Address mismatch" }, { status: 400, headers: response.headers });
  }

  session.walletAddress = recovered;
  session.authenticated = true;
  session.nonce = undefined;
  session.nonceExpiresAt = undefined;
  await session.save();

  return NextResponse.json({ ok: true, address: recovered }, { headers: response.headers });
}
