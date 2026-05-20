import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { AccessibilityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("AccessibilityRole.run (failed)", () => {
  it("emits accessibility.failed with critical count when model returns critical issue", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: {
          passed: false,
          issues: [
            { severity: "critical", code: "A11Y-WCAG-004", message: "Image missing alt text (WCAG 1.1.1 AA)" },
            { severity: "high", code: "A11Y-CON-003", message: "Contrast ratio below 4.5:1 on body text" }
          ],
          skillsRun: ["wcag-audit", "contrast-check"]
        } }],
      model: "claude-sonnet-4-6", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 40 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new AccessibilityRole({ llm, skills });

    const out = await role.run({
      ritualId: "r-a11y-fail",
      intent: "accessibility",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "check this diff"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("accessibility.started");
    expect(types).toContain("accessibility.failed");
    expect(types).toContain("accessibility.completed");
    expect(out.diff.kind).toBe("none");

    const failedEvent = out.events.find((e) => e.eventType === "accessibility.failed");
    expect((failedEvent?.payload as { critical: number }).critical).toBe(1);
    expect((failedEvent?.payload as { total: number }).total).toBe(2);

    const completed = out.events.find((e) => e.eventType === "accessibility.completed");
    expect((completed?.payload as { passed: boolean }).passed).toBe(false);
  });

  it("does not throw on failed accessibility check — caller decides policy", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: { passed: false, issues: [{ severity: "critical", code: "A11Y-KB-001", message: "Keyboard trap detected" }], skillsRun: ["keyboard-nav"] } }],
      model: "claude-sonnet-4-6", stop_reason: "tool_use",
      usage: { input_tokens: 80, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new AccessibilityRole({ llm, skills });

    // Should resolve normally, not reject
    await expect(role.run({
      ritualId: "r-a11y-nothrow",
      intent: "accessibility",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "diff with a11y issues"
    })).resolves.toBeDefined();
  });
});
