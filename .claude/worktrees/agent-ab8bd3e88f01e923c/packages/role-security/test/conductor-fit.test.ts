import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { Conductor } from "@atlas/conductor";
import { SecurityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("SecurityRole satisfies @atlas/conductor's Role interface", () => {
  it("Conductor.dispatch with roleId=security returns diff.kind=none + events via SecurityRole", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: { passed: true, issues: [], skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"] } }],
      model: "claude-opus-4-7", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new SecurityRole({ llm, skills });

    const checkpoints: Array<{ eventType: string }> = [];
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "security", confidence: 0.95 }) },
      roles: new Map([["security", role]]),
      checkpointSink: { emit: async (e) => { checkpoints.push(e); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const result = await conductor.dispatch({
      ritualId: "r-sec-fit" as never,
      graphVersion: 1,
      userTurn: "check for security issues",
      projectId: "33333333-3333-4333-8333-333333333333"
    });

    expect(result.roleId).toBe("security");
    expect(result.attempts).toBe(1);

    const checkpointTypes = checkpoints.map((c) => c.eventType);
    expect(checkpointTypes).toContain("dispatch.classified");
    expect(checkpointTypes).toContain("dispatch.completed");

    expect(result.output.diff.kind).toBe("none");
    const roleEventTypes = result.output.events.map((e) => e.eventType);
    expect(roleEventTypes).toContain("security.started");
    expect(roleEventTypes).toContain("security.passed");
    expect(roleEventTypes).toContain("security.completed");
  });
});
