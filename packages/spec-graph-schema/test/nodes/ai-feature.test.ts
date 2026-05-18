import { describe, expect, it } from "vitest";
import { AIFeatureSchema } from "../../src/nodes/ai-feature.js";

const valid = {
  kind: "aifeature" as const,
  id: "aifeature:summarize",
  name: "DocumentSummarizer",
  category: "summarization",
  capabilityContract: { maxInputTokens: 100_000, outputFormat: "markdown" },
  inputModality: "text",
  outputModality: "text",
  grounding: "none",
  personalization: "none",
  privacyMode: "no-retain",
  safetyContract: { promptInjectionGuard: true, hallucinationGuard: false },
  fallbackBehavior: "show-error-and-suggest-retry",
  costTier: "standard"
};

describe("AIFeatureSchema", () => {
  it("accepts valid feature", () => {
    expect(() => AIFeatureSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown grounding", () => {
    expect(() => AIFeatureSchema.parse({ ...valid, grounding: "vibes" })).toThrow();
  });
  it("rejects unknown personalization", () => {
    expect(() => AIFeatureSchema.parse({ ...valid, personalization: "max" })).toThrow();
  });
  it("rejects unknown costTier", () => {
    expect(() => AIFeatureSchema.parse({ ...valid, costTier: "infinite" })).toThrow();
  });
});
