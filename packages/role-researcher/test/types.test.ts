import { describe, it, expect } from "vitest";
import {
  InspirationBriefSchema,
  DesignIntentSchema,
  type InspirationBrief
} from "../src/types.js";

describe("DesignIntentSchema", () => {
  it("accepts a minimal valid intent", () => {
    const parsed = DesignIntentSchema.parse({
      category: "restaurant-landing",
      audienceCues: []
    });
    expect(parsed.category).toBe("restaurant-landing");
    expect(parsed.audienceCues).toEqual([]);
  });

  it("rejects missing category", () => {
    expect(() => DesignIntentSchema.parse({ audienceCues: [] })).toThrow();
  });

  it("accepts audience cues array", () => {
    const parsed = DesignIntentSchema.parse({
      category: "restaurant-landing",
      audienceCues: ["fine-dining", "premium", "mumbai"]
    });
    expect(parsed.audienceCues).toEqual(["fine-dining", "premium", "mumbai"]);
  });
});

describe("InspirationBriefSchema", () => {
  const validBrief: InspirationBrief = {
    category: "restaurant-landing",
    audienceCues: ["fine-dining"],
    references: [
      {
        name: "Bombay Canteen",
        url: "https://thebombaycanteen.com",
        why: "Editorial serif + warm photography matched the premium signal",
        sourceTier: "local-catalog",
        palettePreview: ["#0a0a0a", "#fbbf24"],
        typographyPreview: { primary: "IBM Plex Serif", secondary: "Inter" }
      }
    ],
    patternsThatWin: ["above-the-fold reservation CTA"],
    patternsThatLose: ["stock photo carousels"]
  };

  it("parses a valid brief", () => {
    const parsed = InspirationBriefSchema.parse(validBrief);
    expect(parsed.references).toHaveLength(1);
    expect(parsed.references[0].sourceTier).toBe("local-catalog");
  });

  it("rejects sourceTier outside enum", () => {
    const bad = { ...validBrief, references: [{ ...validBrief.references[0], sourceTier: "wikipedia" }] };
    expect(() => InspirationBriefSchema.parse(bad)).toThrow();
  });

  it("makes url optional", () => {
    const noUrl = { ...validBrief, references: [{ ...validBrief.references[0], url: undefined }] };
    expect(() => InspirationBriefSchema.parse(noUrl)).not.toThrow();
  });

  it("makes palettePreview optional", () => {
    const noPalette = { ...validBrief, references: [{ ...validBrief.references[0], palettePreview: undefined }] };
    expect(() => InspirationBriefSchema.parse(noPalette)).not.toThrow();
  });

  it("requires references array (can be empty)", () => {
    const empty = { ...validBrief, references: [] };
    expect(() => InspirationBriefSchema.parse(empty)).not.toThrow();
  });

  it("rejects missing references", () => {
    const { references: _r, ...noRefs } = validBrief;
    expect(() => InspirationBriefSchema.parse(noRefs)).toThrow();
  });
});
