import { describe, it, expect } from "vitest";
// We test the helper directly. Export it from deep-plan.ts for testing.
import { synthesizeCanvasManifest } from "../src/deep-plan.js";

describe("synthesizeCanvasManifest", () => {
  it("new-app → frontend-app manifest with designing default+blocking + preview", () => {
    const m = synthesizeCanvasManifest("new-app", { specGraph: { kind: "frontend-app" } });
    expect(m).toBeDefined();
    expect(m!.artifactKind).toBe("frontend-app");
    expect(m!.modes.find((mm) => mm.id === "designing")?.blockingFor).toBe("design");
    expect(m!.modes.map((mm) => mm.id).sort()).toEqual(["designing", "preview"]);
  });

  it("new-app with backend-rest-api specGraph → schema manifest", () => {
    const m = synthesizeCanvasManifest("new-app", { specGraph: { kind: "backend-rest-api" } });
    expect(m!.artifactKind).toBe("backend-rest-api");
    expect(m!.modes.some((mm) => mm.id === "schema")).toBe(true);
  });

  it("refactor → no manifest (returns undefined)", () => {
    const m = synthesizeCanvasManifest("refactor", {});
    expect(m).toBeUndefined();
  });

  it("ship → no manifest (returns undefined)", () => {
    const m = synthesizeCanvasManifest("ship", {});
    expect(m).toBeUndefined();
  });
});
