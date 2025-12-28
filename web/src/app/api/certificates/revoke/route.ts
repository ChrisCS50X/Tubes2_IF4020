import { NextRequest, NextResponse } from "next/server";
import { createRevokeTypedData, signTypedData } from "@/lib/eip712";

export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: "Deprecated endpoint. Submit revoke transactions directly from the connected wallet.",
    },
    { status: 410 }
  );
}
