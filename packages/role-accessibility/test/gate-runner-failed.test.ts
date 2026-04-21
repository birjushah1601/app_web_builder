import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { AccessibilityGateRunner } from "../src/gate-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("AccessibilityGateRunner (failed)", () => {
  it("returns status=failed and summary mentions critical count when model emits critical issues", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: {
          passed: false,
          issues: [
            { severity: "critical", code: "A11Y-WCAG-004", message: "Image missing alt text (WCAG 1.1.1 AA)" },
            { severity: "critical", code: "A11Y-KB-001", message: "Keyboard trap detected in modal" },
            { severity: "high", code: "A11Y-CON-003", message: "Contrast ratio below 4.5:1 on body text" }
          ],
          skillsRun: ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"]
        } }],
      model: "claude-sonnet-4-6", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const runner = new AccessibilityGateRunner({ llm, skills });

    const result = await runner.run({
      ritualId: "r-gate-a11y-fail",
      projectId: "11111111-1111-4111-8111-111111111111",
      commitSha: "deadbeef",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    });

    expect(result.layer).toBe("L5");
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("2 critical");
    expect(result.issues).toBeDefined();
    expect(result.issues?.some((i) => i.severity === "critical")).toBe(true);
  });
});
