// apps/atlas-web/e2e/global-setup.ts
import { chromium } from "@playwright/test";
import { clerkClient } from "@clerk/clerk-sdk-node";
import path from "node:path";
import fs from "node:fs/promises";

const PERSONAS = [
  { email: "ama@atlas-test.dev",   password: process.env.ATLAS_TEST_PASSWORD!, file: "ama.json"   },
  { email: "diego@atlas-test.dev", password: process.env.ATLAS_TEST_PASSWORD!, file: "diego.json" },
  { email: "priya@atlas-test.dev", password: process.env.ATLAS_TEST_PASSWORD!, file: "priya.json" },
] as const;

export default async function globalSetup() {
  const authDir = path.resolve("e2e/auth");
  await fs.mkdir(authDir, { recursive: true });

  // Ensure each Clerk test user exists (idempotent)
  for (const p of PERSONAS) {
    const existing = await clerkClient.users.getUserList({ emailAddress: [p.email] });
    if (existing.totalCount === 0) {
      await clerkClient.users.createUser({
        emailAddress: [p.email],
        password: p.password,
        publicMetadata: { atlasPersona: p.file.replace(".json", "") },
      });
    }
  }

  // Sign each user in via browser and save storageState
  const browser = await chromium.launch();
  for (const p of PERSONAS) {
    const page = await browser.newPage();
    await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000");
    await page.getByLabel("Email address").fill(p.email);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel("Password").fill(p.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");
    await page.context().storageState({ path: path.join(authDir, p.file) });
    await page.close();
  }
  await browser.close();
}
