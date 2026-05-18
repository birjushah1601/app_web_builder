import { describe, it, expect } from "vitest";
import { renderCritiqueUserTurn } from "../src/critique-prompt.js";

describe("renderCritiqueUserTurn", () => {
  it("leads with patternsThatWin and patternsThatLose before the draft", () => {
    const brief = {
      category: "restaurant-landing",
      audienceCues: [],
      references: [],
      patternsThatWin: ["chef portrait", "menu with photos"],
      patternsThatLose: ["fake testimonials", "generic hero stock photo"]
    };
    const draft = { recommended: { id: "x" }, alternates: [], reasoning: "x" };
    const out = renderCritiqueUserTurn(brief, draft);
    // Patterns must appear BEFORE the draft serialization
    const patternsIdx = out.indexOf("chef portrait");
    const draftIdx = out.indexOf('"id": "x"');
    expect(patternsIdx).toBeGreaterThan(-1);
    expect(draftIdx).toBeGreaterThan(-1);
    expect(patternsIdx).toBeLessThan(draftIdx);
    expect(out).toContain("MUST appear");
    expect(out).toContain("MUST NOT appear");
    expect(out).toContain("Generic SaaS or landing-page conventions don't apply");
  });
});
