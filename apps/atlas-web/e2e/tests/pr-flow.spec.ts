// apps/atlas-web/e2e/tests/pr-flow.spec.ts
import { expect } from "@playwright/test";
import { SpecGraphRepo } from "@atlas/spec-graph-data";
import { makeFreshProjectTest } from "../fixtures/index.js";

const test = makeFreshProjectTest({ persona: "diego", projectName: "pr-flow" });

test.describe("Diego: Code view edit → PR pane → merge → Spec Graph persists", () => {
  test("Spec Graph node title mutation via Code view is durable after PR merge", async ({ freshProject: { page, projectId } }) => {
    await page.goto(`/projects/${projectId}/code`);
    await expect(page.getByTestId("monaco-editor")).toBeVisible({ timeout: 30_000 });

    // Edit the home page title via the Monaco-backed field
    await page.getByTestId("spec-field-page-home-title").fill("Welcome — Updated");
    await page.keyboard.press("Tab");

    // Open PR pane
    await page.getByTestId("pr-pane-trigger").click();
    const prPane = page.getByTestId("pr-pane");
    await expect(prPane).toBeVisible();
    await expect(prPane.getByTestId("pr-diff-summary")).toContainText(/title/i);

    // Create and merge PR
    await prPane.getByRole("button", { name: /open pull request/i }).click();
    await expect(prPane.getByTestId("pr-status")).toHaveText(/open/i, { timeout: 30_000 });
    await prPane.getByRole("button", { name: /merge/i }).click();
    await expect(prPane.getByTestId("pr-status")).toHaveText(/merged/i, { timeout: 30_000 });

    // Verify Spec Graph mutation persisted in Postgres
    const repo = new SpecGraphRepo(process.env.DATABASE_URL!);
    const graph = await repo.findByProjectId(projectId);
    expect(graph).not.toBeNull();
    expect((graph!.nodes as Record<string, { title: string }>)["page:home"].title).toBe("Welcome — Updated");
  });
});
