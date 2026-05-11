import "./globals.css";
import type { ReactNode } from "react";
import { DesignTokensStyle } from "./design-tokens-style";

export const metadata = {
  title: "Atlas Sandbox",
  description: "Live preview running inside Atlas's E2B sandbox."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Emits :root CSS vars from src/design-tokens.json. HMR-safe — the
            chunk is invalidated when the JSON changes. */}
        <DesignTokensStyle />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
