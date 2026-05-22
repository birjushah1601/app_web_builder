/**
 * OUTCOME B — Fixture-driven (not full-backend-flow)
 *
 * Investigation summary
 * ─────────────────────
 * apps/atlas-web/e2e/ has two harness styles:
 *
 *   1. e2e/tests/   — full-ritual specs using makeFreshProjectTest, which
 *      provisions a real Postgres row + E2B sandbox per run.  This is the
 *      Outcome A harness the plan hoped for, but it has NO schema-architect
 *      variant today.  Standing one up is a multi-day project (new ritual
 *      seed, LLM mock SSE stream, pause-registry test hook).
 *
 *   2. e2e/visual/  — fixture-driven specs that hit /visual-fixtures/* pages
 *      served with canned data via EventStreamCtxForTesting.  T22
 *      (schema-canvas-three-directions.spec.ts) already lives here.
 *
 * Outcome A would require:
 *   - A new spec-graph seed with a schema-architect ritual
 *   - An LLM mock that emits schema_architect.proposal.emitted over SSE
 *   - A CanvasPauseRegistry test hook so the action doesn't need auth+DB
 *   This is intentionally deferred as a follow-up task.
 *
 * This spec delivers Outcome B: it drives the existing
 * /visual-fixtures/schema-canvas fixture page end-to-end.
 * The page already renders the full canned SchemaProposal (3 cards,
 * REST + GraphQL alternates, event-sourced alternate) so we get real
 * UI coverage of the pause point.
 *
 * The selectSchemaDirection server action is intercepted via page.route()
 * so the test passes without a real DB, auth, or CanvasPauseRegistry.
 * The intercepted request body is inspected to assert the correct
 * directionId is forwarded.
 *
 * Follow-up task: "test(atlas-web): Outcome-A full-flow backend-ritual
 * schema-pause spec — add LLM mock SSE + pause-registry test hook"
 */

import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "../visual/helpers/set-persona";

// ---------------------------------------------------------------------------
// Next.js Server Actions POST to the same URL with a content-type of
// "text/plain;charset=UTF-8" (for inline actions) or
// "application/x-www-form-urlencoded" (for bound actions).
// We intercept every POST to the fixture page to capture the call and
// return a synthetic 200 so the component can transition to "submitted".
// ---------------------------------------------------------------------------

type CapturedActionCall = { body: string };

async function setupActionInterceptor(
  page: import("@playwright/test").Page
): Promise<() => CapturedActionCall | null> {
  let captured: CapturedActionCall | null = null;

  await page.route("**/visual-fixtures/schema-canvas**", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      captured = { body: req.postData() ?? "" };
      // Return a minimal Next.js server-action success envelope.
      // The exact shape is an opaque RSC response — an empty 200 causes
      // Next.js to treat the action as succeeded on the client side.
      route.fulfill({ status: 200, contentType: "text/x-component", body: "0" });
    } else {
      route.continue();
    }
  });

  return () => captured;
}

// ---------------------------------------------------------------------------
// Test 1: Navigate to the fixture page; all 3 direction cards are visible;
// clicking a card expands the detail pane.
// ---------------------------------------------------------------------------
test("schema-canvas fixture — 3 direction cards render and a card click expands detail", async ({
  page
}) => {
  await gotoWithPersona(page, "/visual-fixtures/schema-canvas", "ama");

  const canvas = page.getByTestId("schema-canvas");
  await expect(canvas).toBeVisible();

  const cards = page.getByTestId("schema-direction-card");
  await expect(cards).toHaveCount(3);

  // Detail pane is hidden until a card is selected
  await expect(page.getByTestId("schema-direction-detail")).not.toBeVisible();

  // Click the recommended card (first one)
  await cards.first().click();

  // Detail pane should appear
  await expect(page.getByTestId("schema-direction-detail")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 2: Click "Use this direction" on the recommended (REST) card — the
// server action is called with the correct directionId and the UI transitions
// to "Selected — Developer building…".
// ---------------------------------------------------------------------------
test("schema-canvas fixture — selecting recommended REST direction calls server action with restful-crud id", async ({
  page
}) => {
  const getCapture = await setupActionInterceptor(page);

  await gotoWithPersona(page, "/visual-fixtures/schema-canvas", "diego");

  const cards = page.getByTestId("schema-direction-card");
  // First card is the recommended RESTful CRUD direction
  await cards.first().click();
  await expect(page.getByTestId("schema-direction-detail")).toBeVisible();

  const useThisBtn = page.getByRole("button", { name: /use this direction/i });
  await expect(useThisBtn).toBeVisible();
  await useThisBtn.click();

  // The UI should replace the button with the confirmation status
  await expect(page.getByRole("status")).toHaveText(/Selected — Developer building/i, {
    timeout: 10_000
  });

  // The server action POST must have been captured
  const capture = getCapture();
  expect(capture, "server action POST should have been intercepted").not.toBeNull();
  // directionId for the recommended REST proposal is "restful-crud"
  expect(capture!.body).toContain("restful-crud");
});

// ---------------------------------------------------------------------------
// Test 3: Click "Use this direction" on the second (GraphQL / RPC-style)
// alternate — the server action is called with the rpc-style directionId.
// ---------------------------------------------------------------------------
test("schema-canvas fixture — selecting GraphQL alternate calls server action with rpc-style id", async ({
  page
}) => {
  const getCapture = await setupActionInterceptor(page);

  await gotoWithPersona(page, "/visual-fixtures/schema-canvas", "priya");

  const cards = page.getByTestId("schema-direction-card");
  // Second card is the RPC-style / GraphQL alternate
  await cards.nth(1).click();
  await expect(page.getByTestId("schema-direction-detail")).toBeVisible();

  const useThisBtn = page.getByRole("button", { name: /use this direction/i });
  await useThisBtn.click();

  await expect(page.getByRole("status")).toHaveText(/Selected — Developer building/i, {
    timeout: 10_000
  });

  const capture = getCapture();
  expect(capture, "server action POST should have been intercepted").not.toBeNull();
  expect(capture!.body).toContain("rpc-style");
});
