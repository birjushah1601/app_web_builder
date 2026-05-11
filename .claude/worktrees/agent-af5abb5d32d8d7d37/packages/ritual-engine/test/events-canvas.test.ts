import { describe, it, expect } from "vitest";
import { RitualEventSchema } from "../src/events.js";

describe("RitualEventSchema (canvas events)", () => {
  it("accepts architect.canvas_manifest.emitted", () => {
    const ev = RitualEventSchema.parse({
      type: "architect.canvas_manifest.emitted",
      ritualId: "r-1",
      ts: "2026-05-02T00:00:00Z",
      payload: {
        manifest: {
          artifactKind: "frontend-app",
          modes: [{ id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" }]
        }
      }
    });
    expect(ev.type).toBe("architect.canvas_manifest.emitted");
  });

  it("accepts canvas.options.requested", () => {
    const ev = RitualEventSchema.parse({
      type: "canvas.options.requested",
      ritualId: "r-1",
      ts: "2026-05-02T00:00:00Z",
      payload: {
        proposal: { recommended: { id: "x" } },
        manifest: { artifactKind: "frontend-app", modes: [{ id: "designing", renderer: "designing", audience: ["ama"] }] }
      }
    });
    expect(ev.type).toBe("canvas.options.requested");
  });

  it("accepts canvas.option.selected", () => {
    const ev = RitualEventSchema.parse({
      type: "canvas.option.selected",
      ritualId: "r-1",
      ts: "2026-05-02T00:00:00Z",
      payload: { directionId: "editorial-dark", tokens: {}, autoSelected: false }
    });
    expect(ev.type).toBe("canvas.option.selected");
  });
});
