import { describe, it, expect } from "vitest";
import {
  CanvasOptionsRequestedSchema,
  CanvasOptionSelectedSchema,
  CanvasRefinementStartedSchema,
  CanvasRefinementCompletedSchema,
  ArchitectCanvasManifestEmittedSchema,
  CanvasEventSchema
} from "../src/events.js";

describe("ArchitectCanvasManifestEmittedSchema", () => {
  it("parses a valid event", () => {
    const ok = ArchitectCanvasManifestEmittedSchema.parse({
      type: "architect.canvas_manifest.emitted",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: {
        manifest: {
          artifactKind: "frontend-app",
          modes: [{ id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" }]
        }
      }
    });
    expect(ok.payload.manifest.artifactKind).toBe("frontend-app");
  });
});

describe("CanvasOptionsRequestedSchema", () => {
  it("requires proposal payload", () => {
    expect(() =>
      CanvasOptionsRequestedSchema.parse({
        type: "canvas.options.requested",
        ritualId: "r-1",
        ts: "2026-05-02T12:00:00Z",
        payload: {}
      })
    ).toThrow();
  });
});

describe("CanvasOptionSelectedSchema", () => {
  it("captures selected directionId + tokens", () => {
    const ok = CanvasOptionSelectedSchema.parse({
      type: "canvas.option.selected",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: {
        directionId: "editorial-dark",
        tokens: { palette: { primary: "#000", accent: "#fff", surface: "#fafafa", text: "#0a0a0a", muted: "#888" } },
        autoSelected: false
      }
    });
    expect(ok.payload.directionId).toBe("editorial-dark");
  });
});

describe("CanvasRefinementStartedSchema / CompletedSchema", () => {
  it("started carries axes list", () => {
    const ok = CanvasRefinementStartedSchema.parse({
      type: "canvas.refinement.started",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: { fromDirectionId: "editorial-dark", axes: ["palette", "typography", "density"] }
    });
    expect(ok.payload.axes).toContain("palette");
  });

  it("completed carries refinedTokens", () => {
    const ok = CanvasRefinementCompletedSchema.parse({
      type: "canvas.refinement.completed",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: { fromDirectionId: "editorial-dark", refinedTokens: { palette: { primary: "#111" } } }
    });
    expect(ok.payload.fromDirectionId).toBe("editorial-dark");
  });
});

describe("CanvasEventSchema (union)", () => {
  it("accepts every canvas variant", () => {
    const ev = CanvasEventSchema.parse({
      type: "canvas.option.selected",
      ritualId: "r-1",
      ts: "2026-05-02T12:00:00Z",
      payload: { directionId: "x", tokens: {}, autoSelected: false }
    });
    expect(ev.type).toBe("canvas.option.selected");
  });
});
