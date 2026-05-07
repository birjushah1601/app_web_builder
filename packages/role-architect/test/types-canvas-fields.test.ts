import { describe, it, expect } from "vitest";
import { ArchitectOutputSchema } from "../src/types.js";

const baseSlice = { bytes: "{}", hash: "sha256:" + "0".repeat(64) };

describe("ArchitectOutput (canvas fields)", () => {
  it("new-app accepts designIntent + canvasManifest", () => {
    const ok = ArchitectOutputSchema.parse({
      scope: "new-app",
      specGraph: {},
      runnablePlan: { tasks: [] },
      graphSlice: baseSlice,
      designIntent: { category: "restaurant-landing", audienceCues: ["premium"] },
      canvasManifest: {
        artifactKind: "frontend-app",
        modes: [{ id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" }]
      }
    });
    expect((ok as { canvasManifest: { artifactKind: string } }).canvasManifest.artifactKind).toBe("frontend-app");
  });

  it("new-app accepts undefined canvas fields (back-compat)", () => {
    const ok = ArchitectOutputSchema.parse({
      scope: "new-app", specGraph: {}, runnablePlan: { tasks: [] }, graphSlice: baseSlice
    });
    expect((ok as { canvasManifest?: unknown }).canvasManifest).toBeUndefined();
  });

  it("rejects malformed canvasManifest", () => {
    expect(() =>
      ArchitectOutputSchema.parse({
        scope: "new-app", specGraph: {}, runnablePlan: { tasks: [] }, graphSlice: baseSlice,
        canvasManifest: { artifactKind: "not-a-real-kind", modes: [] }
      })
    ).toThrow();
  });

  it("refactor scope also accepts canvas fields (no-op for that scope)", () => {
    const ok = ArchitectOutputSchema.parse({
      scope: "refactor",
      beforeAfterGraph: { before: {}, after: {} },
      behaviorPreservationContract: [],
      regressionTests: [],
      graphSlice: baseSlice
    });
    expect(ok.scope).toBe("refactor");
  });
});
