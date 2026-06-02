import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { ResearcherRole } from "../src/role.js";

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

/**
 * Plan G.4 Task 3 — ResearcherRole records token usage tagged with its
 * own roleId after the brief-assembly LLM call. Fast-mode (no LLM) records
 * nothing.
 */
describe("ResearcherRole — usageTracker.record (Plan G.4 Task 3)", () => {
  const validBriefReply = (category: string) => ({
    category,
    audienceCues: [],
    references: [{ name: "X", why: "y", sourceTier: "local-catalog" }],
    patternsThatWin: ["a"],
    patternsThatLose: ["b"]
  });

  it("records LLM usage tagged roleId='researcher' for the considered-mode brief call", async () => {
    const llm = {
      name: "anthropic",
      completeWithToolUse: vi.fn().mockResolvedValue({
        toolName: "emit_brief",
        input: validBriefReply("restaurant-landing"),
        usage: { inputTokens: 120, outputTokens: 60 }
      })
    } as unknown as Parameters<typeof ResearcherRole.prototype["run"]> extends [infer _] ? never : never;

    const record = vi.fn();
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR });

    await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "build a restaurant landing",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } },
      usageTracker: { record }
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 120, outputTokens: 60 },
      { roleId: "researcher" }
    );
  });

  it("does NOT record in fast-mode (no LLM call happens)", async () => {
    const llm = {
      name: "anthropic",
      completeWithToolUse: vi.fn()
    };
    const record = vi.fn();
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR, mode: "fast" });

    await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } },
      usageTracker: { record }
    });

    expect(record).not.toHaveBeenCalled();
  });
});
