import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

/**
 * Plan G.4 Task 3 — ArchitectRole records token usage tagged with its own
 * roleId after every LLM call (triage + deepPlan). Without this, the
 * workflow-engine's per-role cost breakdown collapses all architect spend
 * into the synthetic __unassigned__ bucket and the UI shipped in G.3 is
 * effectively useless.
 */
describe("ArchitectRole — usageTracker.record per-call (Plan G.4 Task 3)", () => {
  it("records token usage with roleId='architect' for both the triage and deepPlan LLM calls", async () => {
    const sdkCreate = vi.fn()
      // Pass 1 — triage
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] }
        }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 25 }
      })
      // Pass 2 — deep plan
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t2", name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "add forgot-password flow", tasks: [] },
            graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
          }
        }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 800, output_tokens: 300 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const record = vi.fn();
    const tracker = { record };

    const role = new ArchitectRole({ llm: provider, skills });
    await role.run({
      ritualId: "r-1",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "add forgot-password",
      usageTracker: tracker
    });

    // Two LLM calls → two records, both tagged with roleId="architect"
    expect(record).toHaveBeenCalledTimes(2);
    for (const call of record.mock.calls) {
      const opts = call[3] as { roleId?: string } | undefined;
      expect(opts?.roleId).toBe("architect");
    }
    // Triage call recorded with its actual tokens
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 100, outputTokens: 25 },
      { roleId: "architect" }
    );
    // Deep-plan call recorded with its actual tokens
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 800, outputTokens: 300 },
      { roleId: "architect" }
    );
  });

  it("runs successfully without a usageTracker (back-compat: no record calls, no error)", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] } }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "x", tasks: [] },
            graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
          } }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-2",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "x"
    });
    expect(out.events.length).toBeGreaterThan(0);
  });
});
