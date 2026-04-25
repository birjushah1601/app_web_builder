// apps/atlas-web/e2e/global-setup.ts
//
// Provisions persona storage states for the auth-required E2E specs by
// signing each test user into Clerk and saving the resulting cookies.
//
// Required secrets (CI: set in repo secrets; local: export in your shell):
//   - CLERK_SECRET_KEY      Clerk Backend API key
//   - ATLAS_TEST_PASSWORD   Password used for the three test users
//
// When either is missing we skip the provisioning step rather than crash —
// auth-free smoke specs (e2e/tests/smoke-*.spec.ts) still run; auth-required
// specs will fail at storageState load time with a clearer error than
// "password must be a string".

import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

const PERSONAS = [
  { email: "ama@atlas-test.dev", file: "ama.json" },
  { email: "diego@atlas-test.dev", file: "diego.json" },
  { email: "priya@atlas-test.dev", file: "priya.json" }
] as const;

export default async function globalSetup() {
  const authDir = path.resolve("e2e/auth");
  await fs.mkdir(authDir, { recursive: true });

  if (!process.env.CLERK_SECRET_KEY || !process.env.ATLAS_TEST_PASSWORD) {
    console.warn(
      "[e2e/global-setup] CLERK_SECRET_KEY or ATLAS_TEST_PASSWORD not set — " +
        "skipping persona provisioning. Auth-required specs will fail with " +
        "ENOENT on e2e/auth/<persona>.json. Auth-free smoke specs still run."
    );
    return;
  }

  // Lazy-require so the import doesn't crash boot when Clerk SDK isn't installed
  // in some restricted environments.
  const { clerkClient } = (await import("@clerk/clerk-sdk-node")) as {
    clerkClient: {
      users: {
        getUserList: (a: { emailAddress: string[] }) => Promise<{ totalCount: number }>;
        createUser: (a: {
          emailAddress: string[];
          password: string;
          publicMetadata: Record<string, unknown>;
        }) => Promise<unknown>;
      };
    };
  };

  const password = process.env.ATLAS_TEST_PASSWORD;

  for (const p of PERSONAS) {
    const existing = await clerkClient.users.getUserList({ emailAddress: [p.email] });
    if (existing.totalCount === 0) {
      await clerkClient.users.createUser({
        emailAddress: [p.email],
        password,
        publicMetadata: { atlasPersona: p.file.replace(".json", "") }
      });
    }
  }

  const browser = await chromium.launch();
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  for (const p of PERSONAS) {
    const page = await browser.newPage();
    await page.goto(baseUrl);
    await page.getByLabel("Email address").fill(p.email);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/");
    await page.context().storageState({ path: path.join(authDir, p.file) });
    await page.close();
  }
  await browser.close();
}
