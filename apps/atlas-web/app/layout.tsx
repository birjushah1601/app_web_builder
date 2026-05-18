import type { Metadata } from "next";
import Link from "next/link";
import { ClerkProvider, SignedIn, UserButton } from "@clerk/nextjs";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Prevent static prerendering — Clerk requires runtime auth context.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atlas",
  description: "AI Builder — Visualize · Agree · Build"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <body className="min-h-screen bg-white text-slate-900 antialiased">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <Link href="/" className="font-semibold">Atlas</Link>
            <SignedIn>
              <UserButton afterSignOutUrl="/sign-in" />
            </SignedIn>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
