import { describe, it, expect } from "vitest";
import { replayEventsToSnapshot } from "../src/hydrator.js";

describe("hydrator (canvas events)", () => {
  it("populates selectedTokens from canvas.option.selected", () => {
    const snap = replayEventsToSnapshot([
      { id: 1n, eventType: "ritual.started", payload: { projectId: "p", userId: "u", intent: "x", editClass: "structural" }, actor: null },
      { id: 2n, eventType: "architect.pass2.completed", payload: { artifact: { scope: "new-app" } }, actor: null },
      { id: 3n, eventType: "designer.proposal.emitted", payload: { recommendedId: "x", alternateIds: ["a", "b"] }, actor: null },
      { id: 4n, eventType: "canvas.option.selected", payload: { directionId: "x", tokens: { palette: { primary: "#000" } }, autoSelected: false }, actor: null }
    ]);
    expect(snap).not.toBeNull();
    expect(snap!.selectedTokens).toEqual({ palette: { primary: "#000" } });
    // canvas events also captured in roleEvents for diagnostic UIs
    expect(snap!.roleEvents.some((e) => e.eventType === "canvas.option.selected")).toBe(true);
  });

  it("captures the manifest from architect.canvas_manifest.emitted", () => {
    const snap = replayEventsToSnapshot([
      { id: 1n, eventType: "ritual.started", payload: { projectId: "p", userId: "u", intent: "x", editClass: "structural" }, actor: null },
      { id: 2n, eventType: "architect.canvas_manifest.emitted", payload: { manifest: { artifactKind: "frontend-app", modes: [{ id: "designing", renderer: "designing", audience: ["ama"] }] } }, actor: null }
    ]);
    expect(snap!.canvasManifest).toBeDefined();
    expect((snap!.canvasManifest as { artifactKind: string }).artifactKind).toBe("frontend-app");
  });
});
