import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole observability", () => {
  it("emits one LLM-request metric per pass with correct model labels", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] } }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 3 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_architect_output",
          input: { scope: "new-feature", diffPlan: { summary: "x", tasks: [] }, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } } }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 20 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    await role.run({
      ritualId: "r-obs",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "add x"
    });

    const snapshots = await registry.getMetricsAsJSON();
    const reqMetric = snapshots.find((m) => m.name === "atlas_llm_provider_requests_total");
    expect(reqMetric).toBeDefined();
    const values = (reqMetric as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values;
    const haikuSuccess = values.find(
      (v) => v.labels.model === "claude-haiku-4-5-20251001" && v.labels.status === "success"
    );
    const opusSuccess = values.find(
      (v) => v.labels.model === "claude-opus-4-7" && v.labels.status === "success"
    );
    expect(haikuSuccess?.value).toBe(1);
    expect(opusSuccess?.value).toBe(1);
  });
});
