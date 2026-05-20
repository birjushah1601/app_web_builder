import "./globals.css";
import type { ReactNode } from "react";
import { DesignTokensStyle } from "./design-tokens-style";
import { AtlasEditBridge } from "../atlas-edit-bridge";

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
      <body className="font-sans antialiased">
        {/* Click-to-edit bridge — streams a flat DOM tree of editable
            elements to the parent window via postMessage. Atlas-web's
            IframeOverlay (behind ATLAS_FF_CLICK_TO_EDIT) consumes the
            stream to render hit-zones over the preview iframe. Always
            mounted; harmless when the iframe has no parent window. */}
        <AtlasEditBridge />
        {children}
      </body>
    </html>
  );
}
