import { describe, it, expect } from "vitest";
import {
  CanvasManifestSchema,
  CanvasModeSchema,
  defaultManifestForArtifactKind,
  type CanvasManifest
} from "../src/types.js";

describe("CanvasModeSchema", () => {
  it("accepts a minimal valid mode", () => {
    const parsed = CanvasModeSchema.parse({
      id: "designing",
      renderer: "designing",
      audience: ["ama", "diego", "priya"]
    });
    expect(parsed.id).toBe("designing");
    expect(parsed.default).toBeUndefined();
  });

  it("rejects empty audience array", () => {
    expect(() =>
      CanvasModeSchema.parse({ id: "designing", renderer: "designing", audience: [] })
    ).toThrow();
  });

  it("accepts blockingFor + default", () => {
    const parsed = CanvasModeSchema.parse({
      id: "designing",
      renderer: "designing",
      audience: ["ama", "diego", "priya"],
      default: true,
      blockingFor: "design"
    });
    expect(parsed.blockingFor).toBe("design");
  });
});

describe("CanvasManifestSchema", () => {
  const valid: CanvasManifest = {
    artifactKind: "frontend-app",
    modes: [
      { id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" },
      { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] }
    ]
  };

  it("parses a valid manifest", () => {
    expect(CanvasManifestSchema.parse(valid).modes).toHaveLength(2);
  });

  it("rejects manifest with no modes", () => {
    expect(() => CanvasManifestSchema.parse({ artifactKind: "frontend-app", modes: [] })).toThrow();
  });

  it("rejects more than one mode marked default", () => {
    expect(() =>
      CanvasManifestSchema.parse({
        ...valid,
        modes: [
          { ...valid.modes[0]!, default: true },
          { ...valid.modes[1]!, default: true }
        ]
      })
    ).toThrow(/only one default/i);
  });
});

describe("defaultManifestForArtifactKind", () => {
  it("frontend-app -> designing+preview, designing default+blocking", () => {
    const m = defaultManifestForArtifactKind("frontend-app");
    expect(m.modes.map((mm) => mm.id).sort()).toEqual(["designing", "preview"]);
    const designing = m.modes.find((mm) => mm.id === "designing")!;
    expect(designing.default).toBe(true);
    expect(designing.blockingFor).toBe("design");
  });

  it("backend-rest-api -> schema only (designing + preview not relevant)", () => {
    const m = defaultManifestForArtifactKind("backend-rest-api");
    expect(m.modes.map((mm) => mm.id)).toContain("schema");
  });
});
