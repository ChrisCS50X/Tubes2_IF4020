import { SessionOptions } from "iron-session";

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  // Fail fast if missing secret in runtime; this should be set in .env.local
  throw new Error("SESSION_SECRET is missing");
}

export type AuthSession = {
  walletAddress?: string;
  nonce?: string;
  nonceExpiresAt?: number;
  authenticated?: boolean;
};

export const sessionOptions: SessionOptions = {
  password: SESSION_SECRET,
  cookieName: "cert-registry-auth",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
};
