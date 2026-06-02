import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

/**
 * Plan G.4 Task 3 — DeveloperRole records token usage tagged with its own
 * roleId after every LLM call (anthropic pass, google pass, reviewer vote).
 * Without this the workflow-engine's per-role cost breakdown collapses
 * everything into the synthetic __unassigned__ bucket.
 */
describe("DeveloperRole — usageTracker.record per-call (Plan G.4 Task 3)", () => {
  it("records usage tagged roleId='developer' for anthropic, google, and reviewer", async () => {
    const anthropicCreate = vi.fn()
      // anthropic pass
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output", input: { diff: "a diff", summary: "a", testsAdded: ["t1.ts"], filesModified: ["a.ts"] } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 200, output_tokens: 80 }
      })
      // reviewer pass
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu2", name: "emit_reviewer_vote", input: { winner: "anthropic", reasoning: "tighter test" } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 150, output_tokens: 20 }
      });
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    const googleGenerate = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "emit_developer_output", args: { diff: "g diff", summary: "g", testsAdded: ["t2.ts"], filesModified: ["a.ts"] } } }] } }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "g diff", summary: "g", testsAdded: ["t2.ts"], filesModified: ["a.ts"] } }]
      }
    }));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const record = vi.fn();
    const tracker = { record };

    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });
    await role.run({
      ritualId: "r-d-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "rename foo to bar",
      usageTracker: tracker
    });

    // 3 LLM records expected: anthropic pass + google pass + reviewer vote
    expect(record).toHaveBeenCalledTimes(3);
    // Every call tagged with roleId="developer"
    for (const call of record.mock.calls) {
      const opts = call[3] as { roleId?: string } | undefined;
      expect(opts?.roleId).toBe("developer");
    }
    // Spot-check actual usage values flowed through
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 200, outputTokens: 80 },
      { roleId: "developer" }
    );
    expect(record).toHaveBeenCalledWith(
      "google",
      expect.any(String),
      { inputTokens: 90, outputTokens: 40 },
      { roleId: "developer" }
    );
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 150, outputTokens: 20 },
      { roleId: "developer" }
    );
  });
});
