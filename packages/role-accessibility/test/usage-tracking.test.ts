import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { AccessibilityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("AccessibilityRole — usageTracker.record (Plan G.4 Task 3)", () => {
  it("records usage tagged roleId='accessibility' after runAccessibilityCheck completes", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{
        type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: { passed: true, issues: [], skillsRun: ["wcag-audit"] }
      }],
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      usage: { input_tokens: 400, output_tokens: 60 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const record = vi.fn();
    const role = new AccessibilityRole({ llm, skills });
    await role.run({
      ritualId: "r1",
      intent: "accessibility",
      userTurn: "diff --git",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      usageTracker: { record }
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 400, outputTokens: 60 },
      { roleId: "accessibility" }
    );
  });
});
