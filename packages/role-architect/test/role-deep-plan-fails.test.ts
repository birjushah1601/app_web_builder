import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";
import { DeepPlanFailedError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole.run (deep-plan throws)", () => {
  it("emits pass2.failed event then re-throws so conductor can retry", async () => {
    const sdkCreate = vi.fn()
      // Pass 1 — triage ok
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] }
        }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 3 }
      })
      // Pass 2 — deep plan returns a non-object that defensive defaults
      // can't repair. enrichArchitectOutput only fills missing fields on
      // object inputs; a string can't be defaulted into a valid scope
      // variant. (Object inputs with missing required fields are now
      // defaulted — see the new "fills empty defaults" test below.)
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t2", name: "emit_architect_output",
          input: "this is not an object"
        }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });

    // Capture events via a try/catch since run() rejects
    let caught: unknown;
    try {
      await role.run({
        ritualId: "r-3",
        intent: "architect",
        graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
        userTurn: "add x"
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeepPlanFailedError);
  });

  it("fills empty defaults when model omits scope-specific fields (e.g. runnablePlan for new-app)", async () => {
    const validHash = "sha256:" + "a".repeat(64);
    // Model picks scope=new-app but ONLY emits scope — omits both specGraph
    // and runnablePlan (real-world failure mode against tools-stripping
    // proxies). Defensive defaults in enrichArchitectOutput should backfill
    // these so the schema parse succeeds; the ritual completes with empty
    // placeholder values rather than escalating.
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-app", questions: [] }
        }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 3 }
      })
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t2", name: "emit_architect_output",
          // Model only emits scope. Both specGraph and runnablePlan are
          // missing. Defaults should land them as {} and { tasks: [] }.
          input: { scope: "new-app" }
        }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-default",
      intent: "architect",
      graphSlice: { bytes: '{"k":"v"}', hash: validHash },
      userTurn: "build a forgot-password feature from scratch"
    });

    // Pass2 completed event carries the artifact
    const completed = out.events.find((e) => e.eventType === "architect.pass2.completed");
    expect(completed).toBeDefined();
    const artifact = (completed!.payload as { artifact: Record<string, unknown> }).artifact;
    expect(artifact.scope).toBe("new-app");
    expect(artifact.specGraph).toEqual({});
    expect(artifact.runnablePlan).toEqual({ tasks: [] });
    // graphSlice always overridden with the input value
    expect(artifact.graphSlice).toEqual({ bytes: '{"k":"v"}', hash: validHash });
  });
});
