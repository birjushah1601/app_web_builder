import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole — artifactKindHint short-circuits artifactKind classification", () => {
  it("when hint is set, canvasManifest.artifactKind matches the hint (overrides specGraph.kind)", async () => {
    // Pass 2 returns specGraph.kind=frontend-app, but the hint says
    // data-pipeline — the hint must win.
    const sdkCreate = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "emit_ambiguity_report",
            input: { passed: true, scope: "new-app", questions: [] }
          }
        ],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 }
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "emit_architect_output",
            input: {
              scope: "new-app",
              specGraph: { kind: "frontend-app" },
              runnablePlan: { tasks: [] }
            }
          }
        ],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 200 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const result = await role.run({
      ritualId: "r-1",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "build a todo app",
      priorArtifact: { artifactKindHint: "data-pipeline" }
    });

    const completed = result.events.find((e) => e.eventType === "architect.pass2.completed");
    expect(completed).toBeDefined();
    const artifact = completed!.payload.artifact as { canvasManifest?: { artifactKind?: string } };
    expect(artifact.canvasManifest?.artifactKind).toBe("data-pipeline");

    // pass1.completed should carry the hintApplied flag for trace debugging.
    const pass1 = result.events.find((e) => e.eventType === "architect.pass1.completed");
    expect(pass1?.payload).toMatchObject({ hintApplied: true });
  });

  it("when hint is unset, falls back to classifier (existing behavior)", async () => {
    const sdkCreate = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "emit_ambiguity_report",
            input: { passed: true, scope: "new-app", questions: [] }
          }
        ],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 }
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "emit_architect_output",
            input: {
              scope: "new-app",
              specGraph: { kind: "frontend-app" },
              runnablePlan: { tasks: [] }
            }
          }
        ],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 200 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const result = await role.run({
      ritualId: "r-1",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "build a todo app"
    });

    const completed = result.events.find((e) => e.eventType === "architect.pass2.completed");
    const artifact = completed!.payload.artifact as { canvasManifest?: { artifactKind?: string } };
    expect(artifact.canvasManifest?.artifactKind).toBe("frontend-app");

    const pass1 = result.events.find((e) => e.eventType === "architect.pass1.completed");
    expect(pass1?.payload).toMatchObject({ hintApplied: false });
  });
});
