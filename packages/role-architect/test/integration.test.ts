import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole end-to-end integration", () => {
  it("routes Pass 2 prompt-cache to the SDK with system array containing the 3 skill bodies", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "bug-fix", questions: [] } }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_architect_output",
          input: {
            scope: "bug-fix",
            bugReport: {
              phase1_reproduce: "steps",
              phase2_isolate: "min case",
              phase3_hypothesize: "h",
              phase4_verify: "v",
              rootCause: "race"
            },
            graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
          } }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 200 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-int",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "login returns 500 on Safari"
    });

    // Validate 4 events + scope-matched artifact
    const typeSet = new Set(out.events.map((e) => e.eventType));
    expect(typeSet.has("architect.pass1.started")).toBe(true);
    expect(typeSet.has("architect.pass1.completed")).toBe(true);
    expect(typeSet.has("architect.pass2.started")).toBe(true);
    expect(typeSet.has("architect.pass2.completed")).toBe(true);

    const completed = out.events.find((e) => e.eventType === "architect.pass2.completed");
    const artifact = completed?.payload.artifact as { scope: string };
    expect(artifact.scope).toBe("bug-fix");

    // Validate Pass 2 request shape
    const pass2Body = sdkCreate.mock.calls[1][0] as Record<string, unknown>;
    const system = pass2Body.system as Array<{ text: string }>;
    const systemJoined = system.map((s) => s.text).join("\n");
    expect(systemJoined).toContain("Skill: brainstorm");
    expect(systemJoined).toContain("Skill: spec-graph");
    expect(systemJoined).toContain("Skill: runnable-plan");
    // "Scope: bug-fix" appears in the user-turn message block (not the system array)
    const msgs = pass2Body.messages as Array<{ role: string; content: string }>;
    const userContent = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    expect(userContent).toContain("Scope: bug-fix");
  });
});
