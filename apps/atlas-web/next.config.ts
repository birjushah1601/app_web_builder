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
    "@atlas/sandbox-e2b",
    "@atlas/observability",
    "@atlas/payments-hardening",
    "@atlas/postgres-branching",
    "@atlas/deploy-orchestrator"
  ]
};

export default nextConfig;
