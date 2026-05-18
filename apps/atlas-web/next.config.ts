import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark workspace packages as server-only — they import Node built-ins
  // (crypto, fs, events, ...) which Webpack can't bundle for the browser.
  // Server Actions in lib/engine/* still resolve these server-side.
  serverExternalPackages: [
    "@atlas/ritual-engine",
    "@atlas/conductor",
    "@atlas/role-architect",
    "@atlas/role-developer",
    "@atlas/role-researcher",
    "@atlas/role-designer",
    "@atlas/role-security",
    "@atlas/role-accessibility",
    "@atlas/gate-visual-quality",
    "@atlas/llm-provider",
    "@atlas/skill-runtime",
    "@atlas/skill-library",
    "@atlas/spec-graph-data",
    "@atlas/spec-graph-ops",
    "@atlas/spec-graph-sync",
    "@atlas/spec-graph-merge-driver",
    "@atlas/spec-graph-schema",
    "@atlas/canvas-runtime",
    "@atlas/run-dashboard",
    "@atlas/auth-keycloak",
    "@atlas/video-kling",
    "@atlas/sandbox-e2b",
    "@atlas/observability",
    "@atlas/payments-hardening",
    "@atlas/postgres-branching",
    "@atlas/deploy-orchestrator",
    "@atlas/edit-patch-engine",
    "@atlas/role-asset-generator"
  ],
  // Plan SPU — cached AI hero images live under `.next/cache/atlas-assets/`
  // and are served back through the dynamic API route. Rewriting keeps the
  // public URL stable across `/atlas-assets/<sha>.jpg`.
  async rewrites() {
    return [
      { source: "/atlas-assets/:hash.jpg", destination: "/api/atlas-assets/:hash" }
    ];
  }
};

export default nextConfig;
