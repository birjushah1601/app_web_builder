// apps/atlas-web/e2e/global-teardown.ts
import { execSync } from "node:child_process";

export default async function globalTeardown() {
  // Kill any atlas-test sandboxes older than 30 min (guards against CI crash)
  try {
    execSync("e2b sandbox kill --all --template atlas-test --older-than 30m", {
      stdio: "inherit",
      timeout: 30_000,
    });
  } catch {
    // Non-fatal: e2b CLI may not be available in all CI environments
  }
}
