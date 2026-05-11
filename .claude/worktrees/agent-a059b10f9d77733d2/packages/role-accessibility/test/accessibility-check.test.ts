import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { runAccessibilityCheck, ACCESSIBILITY_MODEL } from "../src/accessibility-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("runAccessibilityCheck", () => {
  it("returns passed=true when the model reports no issues", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: { passed: true, issues: [], skillsRun: ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"] } }],
      model: ACCESSIBILITY_MODEL, stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const report = await runAccessibilityCheck({ llm, skills, diff: "@@ trivial", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });
    expect(report.passed).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.skillsRun).toContain("wcag-audit");
  });

  it("returns passed=false when the model emits a critical issue", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: {
          passed: false,
          issues: [{ severity: "critical", code: "A11Y-WCAG-004", message: "Image missing alt text (WCAG 1.1.1 AA)" }],
          skillsRun: ["wcag-audit"]
        } }],
      model: ACCESSIBILITY_MODEL, stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 30 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const report = await runAccessibilityCheck({ llm, skills, diff: "@@", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });
    expect(report.passed).toBe(false);
    expect(report.issues[0].severity).toBe("critical");
  });
});
