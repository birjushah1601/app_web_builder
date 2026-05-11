import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { AccessibilityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("AccessibilityRole.run (passed)", () => {
  it("returns role output with accessibility.passed event when no critical issues", async () => {
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

    const out = await role.run({
      ritualId: "r-a11y-1",
      intent: "accessibility",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "check this diff"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("accessibility.started");
    expect(types).toContain("accessibility.passed");
    expect(types).toContain("accessibility.completed");
    expect(out.diff.kind).toBe("none");

    const completed = out.events.find((e) => e.eventType === "accessibility.completed");
    expect((completed?.payload as { passed: boolean }).passed).toBe(true);
  });
});
