import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { Conductor } from "@atlas/conductor";
import { AccessibilityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("AccessibilityRole satisfies @atlas/conductor's Role interface", () => {
  it("Conductor.dispatch with roleId=accessibility returns diff.kind=none + events via AccessibilityRole", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: { passed: true, issues: [], skillsRun: ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"] } }],
      model: "claude-sonnet-4-6", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new AccessibilityRole({ llm, skills });

    const checkpoints: Array<{ eventType: string }> = [];
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "accessibility", confidence: 0.95 }) },
      roles: new Map([["accessibility", role]]),
      checkpointSink: { emit: async (e) => { checkpoints.push(e); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const result = await conductor.dispatch({
      ritualId: "r-a11y-fit" as never,
      graphVersion: 1,
      userTurn: "check for accessibility issues",
      projectId: "33333333-3333-4333-8333-333333333333"
    });

    expect(result.roleId).toBe("accessibility");
    expect(result.attempts).toBe(1);

    const checkpointTypes = checkpoints.map((c) => c.eventType);
    expect(checkpointTypes).toContain("dispatch.classified");
    expect(checkpointTypes).toContain("dispatch.completed");

    expect(result.output.diff.kind).toBe("none");
    const roleEventTypes = result.output.events.map((e) => e.eventType);
    expect(roleEventTypes).toContain("accessibility.started");
    expect(roleEventTypes).toContain("accessibility.passed");
    expect(roleEventTypes).toContain("accessibility.completed");
  });
});
