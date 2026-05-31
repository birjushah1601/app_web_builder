import { describe, it, expect } from "vitest";
import { renderDeveloperUserTurn } from "../src/render-user-turn.js";

/**
 * Plan D.2 Task 4 — when the engine populates `priorArtifact.generatedFiles`
 * for a frontend-app downstream that consumes a backend-rest-api upstream
 * (Plan D.2 Task 3), the developer's user-turn must surface those files
 * verbatim under a "Pre-generated files" heading so the LLM emits them in
 * its diff and the sandbox applier writes them to disk.
 *
 * Note: the developer role passes `inv.priorArtifact` straight into
 * `renderDeveloperUserTurn` as the `architectArtifact` arg (see
 * packages/role-developer/src/role.ts line 65 + 76). So
 * `architectArtifact.generatedFiles` here is the same field the engine
 * sets on `priorArtifact.generatedFiles`.
 */
describe("renderDeveloperUserTurn — priorArtifact.generatedFiles (Plan D.2)", () => {
  it("renders the Pre-generated files section with path + contents when generatedFiles has one entry", () => {
    const apiClientContents = [
      "// Auto-generated typed API client.",
      "export interface User { id: string; name: string }",
      "export async function listUsers(): Promise<User[]> {",
      "  const r = await fetch('/api/users');",
      "  return r.json();",
      "}"
    ].join("\n");
    const out = renderDeveloperUserTurn("build the frontend", {
      upstream: { backend: { kind: "backend-rest-api" } },
      generatedFiles: [
        { path: "src/lib/api-client.ts", contents: apiClientContents }
      ]
    });
    expect(out).toContain("Pre-generated files");
    expect(out).toContain("src/lib/api-client.ts");
    expect(out).toContain("export interface User");
    expect(out).toContain("listUsers");
  });

  it("omits the Pre-generated files section when generatedFiles is missing", () => {
    const out = renderDeveloperUserTurn("build the frontend", {
      upstream: { backend: { kind: "backend-rest-api" } }
      // no generatedFiles key
    });
    expect(out).not.toContain("Pre-generated files");
  });

  it("omits the Pre-generated files section when generatedFiles is an empty array", () => {
    const out = renderDeveloperUserTurn("build the frontend", {
      upstream: { backend: { kind: "backend-rest-api" } },
      generatedFiles: []
    });
    expect(out).not.toContain("Pre-generated files");
  });
});
