// Auth-free smoke tests. These run without persona storageState and only
// hit routes the middleware lets through unauthenticated. Their job is to
// catch "the dev server is broken" / "the sign-in page won't render" /
// "Clerk widget JS failed to load" failures — the cheapest possible
// canary in front of the heavier persona suites.
//
// Required env: nothing. Just a running atlas-web on PLAYWRIGHT_BASE_URL
// (default http://localhost:3000).

import { test, expect } from "@playwright/test";

test.describe("public smoke", () => {
  test("sign-in page renders with the Atlas title and Clerk widget", async ({ page }) => {
    const response = await page.goto("/sign-in");
    expect(response?.ok(), `GET /sign-in returned ${response?.status()}`).toBe(true);

    await expect(page).toHaveTitle(/Atlas/);

    // Clerk's <SignIn /> mounts client-side. Wait for any of the well-known
    // Clerk DOM markers — different Clerk versions render slightly different
    // shells. Falling back across markers makes this resilient to upgrades.
    const clerkRoot = page.locator(
      [
        "[data-clerk-element]",
        "[class*='cl-']",
        "form input[name='identifier']"
      ].join(", ")
    ).first();
    await expect(clerkRoot).toBeVisible({ timeout: 15_000 });
  });

  test("/ redirects to /sign-in for unauthenticated visitors", async ({ page }) => {
    await page.goto("/");
    // Either we land on /sign-in directly or we're already there after redirect.
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
  });

  test("captures a sign-in screenshot for visual review", async ({ page }, testInfo) => {
    await page.goto("/sign-in");
    // Wait for the Clerk widget to be visible rather than networkidle —
    // Clerk's session polling keeps the network non-idle indefinitely.
    const clerkRoot = page.locator(
      [
        "[data-clerk-element]",
        "[class*='cl-']",
        "form input[name='identifier']"
      ].join(", ")
    ).first();
    await expect(clerkRoot).toBeVisible({ timeout: 15_000 });
    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach("sign-in.png", { body: screenshot, contentType: "image/png" });
  });
});
