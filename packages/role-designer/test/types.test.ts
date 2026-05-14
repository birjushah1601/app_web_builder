import { describe, it, expect } from "vitest";
import { DesignTokensSchema, DesignDirectionSchema, DesignProposalSchema, AxisChoiceSchema } from "../src/types.js";

describe("DesignTokensSchema", () => {
  const validTokens = {
    palette: {
      primary: "#0a0a0a",
      accent: "#fbbf24",
      surface: "#fef3c7",
      text: "#1f2937",
      muted: "#6b7280"
    },
    typeScale: {
      sansFamily: "Inter",
      serifFamily: "IBM Plex Serif",
      monoFamily: "JetBrains Mono",
      baseSizePx: 16,
      scale: "minor-third"
    },
    density: "comfortable",
    componentSet: "shadcn",
    imageryStrategy: "photo",
    copyVoice: "premium"
  };

  it("parses fully-specified tokens", () => {
    const parsed = DesignTokensSchema.parse(validTokens);
    expect(parsed.palette.primary).toBe("#0a0a0a");
    expect(parsed.typeScale.scale).toBe("minor-third");
    expect(parsed.density).toBe("comfortable");
  });

  it("makes serifFamily optional", () => {
    const noSerif = { ...validTokens, typeScale: { ...validTokens.typeScale, serifFamily: undefined } };
    expect(() => DesignTokensSchema.parse(noSerif)).not.toThrow();
  });

  it("rejects palette hex without leading #", () => {
    const bad = { ...validTokens, palette: { ...validTokens.palette, primary: "0a0a0a" } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects density outside enum", () => {
    const bad = { ...validTokens, density: "loose" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects scale outside enum", () => {
    const bad = { ...validTokens, typeScale: { ...validTokens.typeScale, scale: "golden-ratio" } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects componentSet outside enum", () => {
    const bad = { ...validTokens, componentSet: "material" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects imageryStrategy outside enum", () => {
    const bad = { ...validTokens, imageryStrategy: "video" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects copyVoice outside enum", () => {
    const bad = { ...validTokens, copyVoice: "snarky" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects baseSizePx below 12", () => {
    const bad = { ...validTokens, typeScale: { ...validTokens.typeScale, baseSizePx: 8 } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects baseSizePx above 24", () => {
    const bad = { ...validTokens, typeScale: { ...validTokens.typeScale, baseSizePx: 32 } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });
});

describe("DesignDirectionSchema", () => {
  const validDirection = {
    id: "editorial-dark",
    name: "Editorial Dark",
    shortDescription: "A premium, magazine-style look with deep blacks and warm accents.",
    technicalDescription: "Inter sans + IBM Plex Serif headline pairing on a near-black surface; amber accent for CTAs; spacious density.",
    citedReferences: ["Bombay Canteen", "Eleven Madison Park"],
    layoutDirective: "Hero with food. Menu by category. NO testimonials.",
    tokens: {
      palette: {
        primary: "#0a0a0a",
        accent: "#fbbf24",
        surface: "#fef3c7",
        text: "#1f2937",
        muted: "#6b7280"
      },
      typeScale: {
        sansFamily: "Inter",
        serifFamily: "IBM Plex Serif",
        monoFamily: "JetBrains Mono",
        baseSizePx: 16,
        scale: "minor-third"
      },
      density: "spacious",
      componentSet: "shadcn",
      imageryStrategy: "photo",
      copyVoice: "premium"
    }
  };

  it("parses a fully-specified direction", () => {
    const parsed = DesignDirectionSchema.parse(validDirection);
    expect(parsed.id).toBe("editorial-dark");
    expect(parsed.citedReferences).toHaveLength(2);
  });

  it("rejects empty id", () => {
    expect(() => DesignDirectionSchema.parse({ ...validDirection, id: "" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => DesignDirectionSchema.parse({ ...validDirection, name: "" })).toThrow();
  });

  it("requires citedReferences (can be empty array)", () => {
    expect(() => DesignDirectionSchema.parse({ ...validDirection, citedReferences: [] })).not.toThrow();
  });

  it("rejects missing tokens", () => {
    const { tokens: _t, ...noTokens } = validDirection;
    expect(() => DesignDirectionSchema.parse(noTokens)).toThrow();
  });
});

describe("DesignProposalSchema", () => {
  const direction = (id: string) => ({
    id,
    name: id,
    shortDescription: "x",
    technicalDescription: "y",
    citedReferences: [],
    layoutDirective: "Hero with food. Menu by category. NO testimonials.",
    tokens: {
      palette: { primary: "#000000", accent: "#ffffff", surface: "#cccccc", text: "#111111", muted: "#888888" },
      typeScale: { sansFamily: "Inter", monoFamily: "Mono", baseSizePx: 16, scale: "minor-third" as const },
      density: "comfortable" as const,
      componentSet: "shadcn" as const,
      imageryStrategy: "photo" as const,
      copyVoice: "premium" as const
    }
  });

  it("requires exactly 2 alternates", () => {
    const valid = {
      recommended: direction("a"),
      alternates: [direction("b"), direction("c")],
      reasoning: "Recommended A because it cites Bombay Canteen — strongest match for premium-restaurant signal."
    };
    expect(() => DesignProposalSchema.parse(valid)).not.toThrow();
  });

  it("rejects 1 alternate", () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b")],
      reasoning: "x"
    };
    expect(() => DesignProposalSchema.parse(bad)).toThrow();
  });

  it("rejects 3 alternates", () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b"), direction("c"), direction("d")],
      reasoning: "x"
    };
    expect(() => DesignProposalSchema.parse(bad)).toThrow();
  });

  it("requires non-empty reasoning", () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b"), direction("c")],
      reasoning: ""
    };
    expect(() => DesignProposalSchema.parse(bad)).toThrow();
  });
});

describe("AxisChoiceSchema", () => {
  it("accepts a palette choice", () => {
    const parsed = AxisChoiceSchema.parse({
      axis: "palette",
      value: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" }
    });
    expect(parsed.axis).toBe("palette");
  });

  it("accepts a density choice", () => {
    const parsed = AxisChoiceSchema.parse({ axis: "density", value: "spacious" });
    expect(parsed.value).toBe("spacious");
  });

  it("rejects unknown axis", () => {
    expect(() => AxisChoiceSchema.parse({ axis: "vibes", value: "loud" })).toThrow();
  });

  it("rejects density outside enum", () => {
    expect(() => AxisChoiceSchema.parse({ axis: "density", value: "loose" })).toThrow();
  });
});
