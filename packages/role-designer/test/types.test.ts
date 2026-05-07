import { describe, it, expect } from "vitest";
import { DesignTokensSchema } from "../src/types.js";

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
