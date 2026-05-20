import { describe, it, expect } from "vitest";
import { refineAxis } from "../src/refine.js";
import { RefineAxisError } from "../src/errors.js";
import type { DesignDirection } from "../src/types.js";

const baseDirection: DesignDirection = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "x",
  technicalDescription: "y",
  citedReferences: ["Bombay Canteen"],
  layoutDirective: "Hero with food. Menu by category. NO testimonials.",
  tokens: {
    palette: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
    typeScale: { sansFamily: "Inter", serifFamily: "IBM Plex Serif", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
    density: "spacious",
    componentSet: "shadcn",
    imageryStrategy: "photo",
    copyVoice: "premium"
  }
};

describe("refineAxis", () => {
  it("merges a palette choice", () => {
    const updated = refineAxis(baseDirection, {
      axis: "palette",
      value: { primary: "#ffffff", accent: "#000000", surface: "#fafafa", text: "#111111", muted: "#999999" }
    });
    expect(updated.tokens.palette.primary).toBe("#ffffff");
    expect(updated.tokens.density).toBe("spacious");
    expect(updated.tokens.typeScale.sansFamily).toBe("Inter");
  });

  it("merges a typeScale choice", () => {
    const updated = refineAxis(baseDirection, {
      axis: "typeScale",
      value: { sansFamily: "Geist", monoFamily: "Geist Mono", baseSizePx: 18, scale: "major-third" }
    });
    expect(updated.tokens.typeScale.sansFamily).toBe("Geist");
    expect(updated.tokens.typeScale.scale).toBe("major-third");
    expect(updated.tokens.palette.primary).toBe("#0a0a0a");
  });

  it("merges a density choice", () => {
    const updated = refineAxis(baseDirection, { axis: "density", value: "compact" });
    expect(updated.tokens.density).toBe("compact");
  });

  it("merges a componentSet choice", () => {
    const updated = refineAxis(baseDirection, { axis: "componentSet", value: "radix-bare" });
    expect(updated.tokens.componentSet).toBe("radix-bare");
  });

  it("merges an imageryStrategy choice", () => {
    const updated = refineAxis(baseDirection, { axis: "imageryStrategy", value: "abstract-gradients" });
    expect(updated.tokens.imageryStrategy).toBe("abstract-gradients");
  });

  it("merges a copyVoice choice", () => {
    const updated = refineAxis(baseDirection, { axis: "copyVoice", value: "playful" });
    expect(updated.tokens.copyVoice).toBe("playful");
  });

  it("does not mutate the input direction", () => {
    const before = JSON.parse(JSON.stringify(baseDirection));
    refineAxis(baseDirection, { axis: "density", value: "compact" });
    expect(baseDirection).toEqual(before);
  });

  it("preserves id + name + citedReferences across merges", () => {
    const updated = refineAxis(baseDirection, { axis: "density", value: "compact" });
    expect(updated.id).toBe("editorial-dark");
    expect(updated.name).toBe("Editorial Dark");
    expect(updated.citedReferences).toEqual(["Bombay Canteen"]);
  });

  it("rejects an unknown axis with RefineAxisError", () => {
    expect(() =>
      refineAxis(baseDirection, { axis: "vibes", value: "loud" } as never)
    ).toThrow(RefineAxisError);
  });

  it("rejects a value that fails the axis-specific schema", () => {
    expect(() =>
      refineAxis(baseDirection, { axis: "density", value: "loose" } as never)
    ).toThrow(RefineAxisError);
  });
});
