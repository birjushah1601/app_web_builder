import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole.run (happy path)", () => {
  it("runs Pass 1 → Pass 2 and returns RoleOutput with ArchitectOutput + 4 events", async () => {
    const sdkCreate = vi.fn()
      // Pass 1 — triage
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] }
        }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 }
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
        usage: { input_tokens: 500, output_tokens: 200 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-1",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "add forgot-password"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("architect.pass1.started");
    expect(types).toContain("architect.pass1.completed");
    expect(types).toContain("architect.pass2.started");
    expect(types).toContain("architect.pass2.completed");

    const completed = out.events.find((e) => e.eventType === "architect.pass2.completed");
    expect(completed).toBeDefined();
    const artifact = completed?.payload.artifact as { scope: string } | undefined;
    expect(artifact?.scope).toBe("new-feature");
    expect(out.diff.kind).toBe("none"); // Architect emits artifacts, not code diffs
  });
});
