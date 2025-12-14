import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";
import { generateNonce, expiryMs } from "@/lib/nonce";

export async function GET(request: Request) {
  // Prepare an empty response to carry the Set-Cookie header
  const response = new NextResponse(null);
  const session = await getIronSession<AuthSession>(request, response, sessionOptions);

  const nonce = generateNonce();
  const expiresAt = expiryMs(5); // 5 minutes

  session.nonce = nonce;
  session.nonceExpiresAt = expiresAt;
  session.authenticated = false;
  await session.save();

  // Reuse headers (includes Set-Cookie) when returning JSON
  return NextResponse.json({ nonce, expiresAt }, { headers: response.headers });
}
