// apps/atlas-web/e2e/fixtures/with-fresh-project.ts
import { test as base, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Sandbox } from "@e2b/sdk";
import { PERSONA_STORAGE_STATE, type Persona } from "./personas.js";
import { minimalSeed, insertSeed, deleteSeed } from "./spec-graph-seeds.js";

export type FreshProjectFixture = {
  projectId: string;
  sandboxId: string;
  page: Page;
};

type FreshProjectOptions = {
  projectName?: string;
  persona?: Persona;
  withSandbox?: boolean;
};

/**
 * Playwright fixture factory — call once per describe block.
 * Returns a `test` with the `freshProject` fixture attached.
 */
export function makeFreshProjectTest(opts: FreshProjectOptions = {}) {
  const { projectName = "e2e-test", persona = "ama", withSandbox = true } = opts;

  return base.extend<{ freshProject: FreshProjectFixture }>({
    storageState: PERSONA_STORAGE_STATE[persona],

    freshProject: async ({ page }, use) => {
      const projectId = randomUUID();
      const name = `${projectName}-${projectId.slice(0, 8)}`;

      // Provision DB row
      const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
      await insertSeed(pool, minimalSeed(projectId, name));

      // Provision E2B sandbox
      let sandbox: Sandbox | null = null;
      let sandboxId = "";
      if (withSandbox) {
        sandbox = await Sandbox.create("atlas-test", {
          apiKey: process.env.E2B_API_KEY!,
          metadata: { projectId, e2eRun: "true" },
        });
        sandboxId = sandbox.sandboxId;
      }

      await use({ projectId, sandboxId, page });

      // Cleanup — always runs even if test throws
      if (sandbox) {
        await sandbox.kill().catch(() => { /* non-fatal */ });
      }
      await deleteSeed(pool, projectId).catch(() => { /* non-fatal */ });
      await pool.end().catch(() => { /* non-fatal */ });
    },
  });
}
