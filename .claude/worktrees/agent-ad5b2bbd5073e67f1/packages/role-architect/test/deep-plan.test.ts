import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { deepPlan, ARCHITECT_DEEP_PLAN_MODEL } from "../src/deep-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

function fixtureRegistry() {
  return createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
}

describe("deepPlan (Pass 2 core)", () => {
  it("calls Opus with 3-tier prompt-cache blocks + assembled skill prompt + scope-tool", async () => {
    const validHash = "sha256:" + "0".repeat(64);
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_plan",
          name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "forgot-password", tasks: [] },
            graphSlice: { bytes: "{}", hash: validHash }
          }
        }
      ],
      model: ARCHITECT_DEEP_PLAN_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 450 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const out = await deepPlan({
      userTurn: "add forgot-password",
      graphSlice: { bytes: "{}", hash: validHash },
      ambiguity: { passed: true, scope: "new-feature", questions: [] },
      skills: fixtureRegistry(),
      llm: provider
    });

    expect(out.scope).toBe("new-feature");
    expect(sdkCreate).toHaveBeenCalledOnce();
    const body = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(body.model).toBe(ARCHITECT_DEEP_PLAN_MODEL);
    expect(body.max_tokens).toBe(8192);
    const system = body.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    // 3-tier cache: role prompt + graph slice + skill-assembled prompt (all cache_control)
    expect(system.length).toBeGreaterThanOrEqual(2);
    expect(system[0].cache_control).toBeDefined();
    // Skill bodies should appear in the assembled prompt
    const joined = system.map((s) => s.text).join("\n");
    expect(joined).toContain("Skill: brainstorm");
    expect(joined).toContain("Skill: spec-graph");
    expect(joined).toContain("Skill: runnable-plan");
  });

  it("injects graphSlice post-hoc when the model omits it (resilience for tools-stripping proxies)", async () => {
    const validHash = "sha256:" + "a".repeat(64);
    // Model returns valid scope-specific fields but DROPS graphSlice — a
    // recurring failure mode against OpenAI-compat proxies that strip the
    // tools[] array. We inject the original graphSlice post-hoc so the
    // ArchitectOutputSchema parse still succeeds.
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_plan",
          name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "add password reset", tasks: [{ title: "form" }] }
            // graphSlice deliberately omitted by the (mocked) model
          }
        }
      ],
      model: ARCHITECT_DEEP_PLAN_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const inputGraphSlice = { bytes: '{"k":"v"}', hash: validHash };
    const out = await deepPlan({
      userTurn: "add forgot-password",
      graphSlice: inputGraphSlice,
      ambiguity: { passed: true, scope: "new-feature", questions: [] },
      skills: fixtureRegistry(),
      llm: provider
    });

    expect(out.scope).toBe("new-feature");
    // The injected graphSlice from the input survives into the parsed output
    expect(out.graphSlice).toEqual(inputGraphSlice);
    // Scope-specific field came from the model untouched
    if (out.scope === "new-feature") {
      expect(out.diffPlan.summary).toBe("add password reset");
    }
  });

  it("throws DeepPlanFailedError when skills are missing", async () => {
    const emptyRegistry = createRegistryWithOverrides([], []);
    const sdk = { messages: { create: vi.fn(), stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await expect(deepPlan({
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      ambiguity: { passed: true, scope: "new-feature", questions: [] },
      skills: emptyRegistry,
      llm: provider
    })).rejects.toThrow(/required skill missing|brainstorm/);
  });
});
