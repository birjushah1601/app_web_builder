import { describe, it, expect } from "vitest";
import { buildPromptCacheBlocks } from "../src/prompt-cache.js";

describe("buildPromptCacheBlocks", () => {
  it("emits 3 tiers: role system, graph slice (cached), user turn", () => {
    const blocks = buildPromptCacheBlocks({
      rolePrompt: "you are the Architect",
      graphSlice: { bytes: '{"nodes":[],"edges":[]}', hash: "sha256:abc" },
      userTurn: "plan a checkout flow"
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ role: "system", content: expect.stringContaining("Architect"), cache_control: { type: "ephemeral" } });
    expect(blocks[1]).toMatchObject({ role: "system", content: expect.stringContaining('"nodes":[]'), cache_control: { type: "ephemeral" } });
    expect(blocks[2]).toMatchObject({ role: "user", content: "plan a checkout flow" });
    expect(blocks[2].cache_control).toBeUndefined();
  });

  it("graph slice content includes the hash for traceability", () => {
    const blocks = buildPromptCacheBlocks({
      rolePrompt: "sys",
      graphSlice: { bytes: '{"nodes":[],"edges":[]}', hash: "sha256:deadbeef" },
      userTurn: "u"
    });
    expect(blocks[1].content).toContain("sha256:deadbeef");
  });

  it("returns LLMMessage shape compatible with @atlas/llm-provider", () => {
    const blocks = buildPromptCacheBlocks({
      rolePrompt: "r",
      graphSlice: { bytes: "{}", hash: "sha256:x" },
      userTurn: "u"
    });
    for (const b of blocks) {
      expect(["system", "user", "assistant"]).toContain(b.role);
      expect(typeof b.content).toBe("string");
    }
  });
});
