// apps/atlas-web/e2e/global-teardown.ts
import { execSync } from "node:child_process";

export default async function globalTeardown() {
  // Kill any sandboxes the fixture provisioned for this e2e run. The fixture
  // (with-fresh-project.ts) tags every sandbox with `metadata: { e2eRun: "true" }`,
  // so we filter by that label rather than by template name (the CLI no longer
  // accepts --template or --older-than as of @e2b/cli 0.5.x).
  //
  // Use `npx @e2b/cli` instead of a bare `e2b` binary — the CLI isn't always
  // installed globally (`'e2b' is not recognized` noise on Windows local runs).
  try {
    execSync(
      "npx --yes @e2b/cli sandbox kill --all --metadata e2eRun=true",
      { stdio: "inherit", timeout: 60_000 }
    );
  } catch {
    // Non-fatal: orphans get garbage-collected by E2B after their TTL anyway.
  }
}
