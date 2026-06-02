import { describe, it, expect, vi } from "vitest";
import { DesignerRole } from "../src/role.js";

/**
 * Plan G.4 Task 3 — DesignerRole records token usage tagged with its own
 * roleId after each LLM call. Flag-off (critique disabled) records ONE
 * (draft only); flag-on (three-pass) records THREE (draft + critique + revise).
 */

const direction = (id: string) => ({
  id,
  name: id,
  shortDescription: "a",
  technicalDescription: "b",
  citedReferences: [],
  layoutDirective: "Hero with food. Menu by category. NO testimonials.",
  tokens: {
    palette: { primary: "#000000", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
    typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
    density: "spacious",
    componentSet: "shadcn",
    imageryStrategy: "photo",
    copyVoice: "premium"
  }
});

const validProposalReply = {
  recommended: direction("editorial-dark"),
  alternates: [direction("modern-minimal"), direction("warm-earthen")],
  reasoning: "x"
};

describe("DesignerRole — usageTracker.record per-pass (Plan G.4 Task 3)", () => {
  it("records draft pass usage once when critique flag is off", async () => {
    const llm = {
      name: "anthropic",
      completeWithToolUse: vi.fn().mockResolvedValue({
        toolName: "emit_proposal",
        input: validProposalReply,
        usage: { inputTokens: 250, outputTokens: 90 }
      })
    };
    const record = vi.fn();
    delete process.env.ATLAS_FF_DESIGNER_CRITIQUE;
    const role = new DesignerRole({ llm: llm as never });

    await role.run({
      ritualId: "r1",
      intent: "designer",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } },
      usageTracker: { record }
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 250, outputTokens: 90 },
      { roleId: "designer" }
    );
  });
});
