import { describe, it, expect } from "vitest";
import { assembleVisualQualityPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const fakeRegistry = (skills: Record<string, string>) =>
  ({
    get(name: string) {
      return skills[name] ? { body: skills[name] } : undefined;
    }
  } as unknown as { get(name: string): { body: string } | undefined });

describe("assembleVisualQualityPrompt", () => {
  it("composes the 3 named skills in order", () => {
    const reg = fakeRegistry({
      "critique-design-tokens": "TOKENS-SKILL-BODY",
      "critique-hierarchy": "HIERARCHY-SKILL-BODY",
      "critique-copy": "COPY-SKILL-BODY"
    });
    const prompt = assembleVisualQualityPrompt(reg as never, [
      "critique-design-tokens",
      "critique-hierarchy",
      "critique-copy"
    ]);
    expect(prompt).toContain("TOKENS-SKILL-BODY");
    expect(prompt).toContain("HIERARCHY-SKILL-BODY");
    expect(prompt).toContain("COPY-SKILL-BODY");
    expect(prompt.indexOf("TOKENS")).toBeLessThan(prompt.indexOf("HIERARCHY"));
    expect(prompt.indexOf("HIERARCHY")).toBeLessThan(prompt.indexOf("COPY"));
  });

  it("throws SkillMissingError when a skill is missing", () => {
    const reg = fakeRegistry({ "critique-design-tokens": "x" });
    expect(() => assembleVisualQualityPrompt(reg as never, ["critique-design-tokens", "critique-missing"])).toThrow(SkillMissingError);
  });
});
