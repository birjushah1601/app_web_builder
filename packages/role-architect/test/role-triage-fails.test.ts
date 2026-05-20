import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole.run (triage returns blockers)", () => {
  it("returns RoleOutput with needs_input events and no artifact; does not call Pass 2", async () => {
    const sdkCreate = vi.fn().mockResolvedValueOnce({
      content: [{
        type: "tool_use", id: "t1", name: "emit_ambiguity_report",
        input: {
          passed: false,
          scope: "new-app",
          questions: [
            { question: "Compliance class?", reason: "PII", severity: "blocker" },
            { question: "Brand tokens?", reason: "advisory", severity: "recommended" }
          ]
        }
      }],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 }
    });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-2",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "build an HIPAA app"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("architect.pass1.started");
    expect(types).toContain("architect.pass1.completed");
    expect(types).toContain("architect.triage.needs_input");
    expect(types).not.toContain("architect.pass2.started");

    // Only blocker questions become needs_input events
    const needsInput = out.events.filter((e) => e.eventType === "architect.triage.needs_input");
    expect(needsInput).toHaveLength(1);

    // No second SDK call
    expect(sdkCreate).toHaveBeenCalledOnce();

    expect(out.diff.kind).toBe("none");
  });
});
