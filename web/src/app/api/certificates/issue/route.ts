import { NextRequest, NextResponse } from "next/server";
import { pinFile } from "@/lib/ipfs/pinata";
import { getIronSession } from "iron-session";
import { sessionOptions, AuthSession } from "@/lib/session";

export type IssueCertificateRequest = {
  encryptedPayload: {
    iv: string;
    tag: string;
    data: string;
    mimeType?: string;
    fileName?: string;
  };
};

export type IssueCertificateResponse = {
  success: boolean;
  ipfsCid?: string;
  storageURI?: string;
  error?: string;
};

/**
 * POST /api/certificates/issue
 * 
 * Pin an encrypted certificate payload to IPFS
 */
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

    const body: IssueCertificateRequest = await request.json();
    const { encryptedPayload } = body;

    if (!encryptedPayload?.iv || !encryptedPayload?.tag || !encryptedPayload?.data) {
      return NextResponse.json(
        { success: false, error: "Encrypted payload is missing fields" },
        { status: 400 }
      );
    }

    const encryptedJson = JSON.stringify(encryptedPayload);
    const encryptedBuffer = Buffer.from(encryptedJson, "utf-8");

    console.log("☁️ Uploading encrypted payload to IPFS...");
    const ipfsResult = await pinFile(
      `certificate-${Date.now()}.json`,
      encryptedBuffer,
      "application/json"
    );

    const storageURI = `ipfs://${ipfsResult.cid}`;

    return NextResponse.json(
      {
        success: true,
        ipfsCid: ipfsResult.cid,
        storageURI,
      },
      { headers: response.headers }
    );
  } catch (error: any) {
    console.error("❌ Error pinning certificate:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to pin certificate"
      },
      { status: 500 }
    );
  }
}
