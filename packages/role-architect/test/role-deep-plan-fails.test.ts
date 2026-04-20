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
      // Pass 2 — deep plan returns an invalid artifact
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t2", name: "emit_architect_output",
          input: { scope: "new-feature" /* missing diffPlan + graphSlice */ }
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
});
