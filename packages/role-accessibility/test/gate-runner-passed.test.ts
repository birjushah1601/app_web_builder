import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { AccessibilityGateRunner } from "../src/gate-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("AccessibilityGateRunner (passed)", () => {
  it("returns GateResult with status=passed, layer=L5 when AccessibilityReport.passed", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: { passed: true, issues: [], skillsRun: ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"] } }],
      model: "claude-sonnet-4-6", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const runner = new AccessibilityGateRunner({ llm, skills });

    const result = await runner.run({
      ritualId: "r-gate-a11y-1",
      projectId: "11111111-1111-4111-8111-111111111111",
      commitSha: "abc1234",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    });

    expect(result.layer).toBe("L5");
    expect(result.status).toBe("passed");
    expect(result.summary).toContain("0");
  });

  it("has layer property equal to L5", () => {
    const llm = {} as never;
    const skills = {} as never;
    const runner = new AccessibilityGateRunner({ llm, skills });
    expect(runner.layer).toBe("L5");
  });
});
