// apps/atlas-web/e2e/global-teardown.ts
import { execSync } from "node:child_process";

export default async function globalTeardown() {
  // Kill any atlas-test sandboxes older than 30 min (guards against CI crash).
  // Use `npx @e2b/cli` instead of a bare `e2b` binary — the CLI isn't always
  // installed globally (`'e2b' is not recognized` noise on Windows local runs).
  try {
    execSync(
      "npx --yes @e2b/cli sandbox kill --all --template atlas-test --older-than 30m",
      { stdio: "inherit", timeout: 60_000 }
    );
  } catch {
    // Non-fatal: orphans get garbage-collected by E2B after their TTL anyway.
  }
}
