// Dev/test-only layout note for Playwright visual fixture routes.
//
// Next.js treats files prefixed with `_` as private (un-routable), so this
// file is documentation only — it is NOT mounted as a layout. The visual
// fixture routes inherit the root layout (`app/layout.tsx`) which already
// provides <html> + <body>. The Clerk header is a thin sliver at the top
// and we crop it from screenshots by snapshotting individual testids
// rather than `fullPage: true` (except where explicitly noted).
//
// Production safety: middleware.ts hard-404s `/__visual__/*` when
// NODE_ENV === "production"; in dev/test the routes are public (no Clerk
// auth required).
import type { ReactNode } from "react";

export default function VisualFixtureLayoutDoc({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
