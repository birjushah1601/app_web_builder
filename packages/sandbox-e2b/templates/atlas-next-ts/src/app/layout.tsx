import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Atlas Sandbox",
  description: "Live preview running inside Atlas's E2B sandbox."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
