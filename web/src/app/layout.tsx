import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Certificate Registry - Blockchain Certificate System",
  description: "Secure blockchain-based certificate issuance and verification system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="min-h-screen bg-slate-950 text-slate-100">
          {/* Navigation Bar */}
          <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
            <div className="mx-auto max-w-5xl px-4 py-4">
              <div className="flex items-center justify-between">
                <a href="/" className="text-xl font-bold text-white">
                  📜 Certificate Registry
                </a>
                <div className="flex gap-4">
                  <a
                    href="/"
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    Home
                  </a>
                  <a
                    href="/issue"
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                  >
                    Issue Certificate
                  </a>
                </div>
              </div>
            </div>
          </nav>
          
          <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
        </div>
      </body>
    </html>
  );
}
