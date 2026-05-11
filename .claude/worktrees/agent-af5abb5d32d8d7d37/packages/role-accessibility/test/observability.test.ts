import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { AccessibilityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("AccessibilityRole observability", () => {
  it("Sonnet call emits labelled Prometheus metrics atlas_llm_provider_requests_total", async () => {
    const registry = new Registry();
    const metrics = createProviderMetrics(registry);

    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_accessibility_report",
        input: { passed: true, issues: [], skillsRun: ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"] } }],
      model: "claude-sonnet-4-6", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new AccessibilityRole({ llm, skills });

    await role.run({
      ritualId: "r-obs-a11y-1",
      intent: "accessibility",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "check for accessibility issues"
    });

    const metricsList = await registry.getMetricsAsJSON();
    const requestsTotal = metricsList.find((m) => m.name === "atlas_llm_provider_requests_total");
    expect(requestsTotal).toBeDefined();
    const values = (requestsTotal as { values: Array<{ labels: Record<string, string>; value: number }> }).values;
    const successValues = values.filter((v) => v.labels.status === "success");
    expect(successValues.length).toBeGreaterThanOrEqual(1);
    // Verify the Sonnet model label
    const sonnetSuccess = successValues.find((v) => v.labels.model === "claude-sonnet-4-6");
    expect(sonnetSuccess).toBeDefined();
    expect(sonnetSuccess?.value).toBeGreaterThanOrEqual(1);
  });
});
