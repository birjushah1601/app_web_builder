import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { Conductor } from "@atlas/conductor";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole satisfies @atlas/conductor's Role interface", () => {
  it("Conductor.dispatch with classifier→architect→role flow returns architect artifact", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] } }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "forgot-password", tasks: [] },
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

    const checkpoints: Array<{ eventType: string }> = [];
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 0.95 }) },
      roles: new Map([["architect", role]]),
      checkpointSink: { emit: async (e) => { checkpoints.push(e); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const result = await conductor.dispatch({
      ritualId: "r-fit" as never,
      graphVersion: 1,
      userTurn: "add forgot-password",
      projectId: "11111111-1111-4111-8111-111111111111"
    });

    expect(result.roleId).toBe("architect");
    expect(result.attempts).toBe(1);
    const types = checkpoints.map((c) => c.eventType);
    expect(types).toContain("dispatch.classified");
    expect(types).toContain("architect.pass1.completed");
    expect(types).toContain("architect.pass2.completed");
    expect(types).toContain("dispatch.completed");
  });
});
