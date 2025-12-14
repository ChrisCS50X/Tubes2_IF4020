import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";

export async function GET(request: Request) {
  const res = NextResponse.json({});
  const session = await getIronSession<AuthSession>(request, res, sessionOptions);
  return NextResponse.json({
    authenticated: !!session.authenticated,
    walletAddress: session.walletAddress || null,
  });
}
