import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: "Deprecated endpoint. Submit issuer rotations directly from the connected wallet.",
    },
    { status: 410 }
  );
}
