import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole observability", () => {
  it("both Anthropic and Google providers increment their labelled Prometheus counters", async () => {
    // Use separate registries so metric names don't clash between providers
    const anthropicRegistry = new Registry();
    const googleRegistry = new Registry();
    const anthropicMetrics = createProviderMetrics(anthropicRegistry);
    const googleMetrics = createProviderMetrics(googleRegistry);

    const anthropicCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output", input: { diff: "anth diff", summary: "a", testsAdded: [], filesModified: ["a.ts"] } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu2", name: "emit_reviewer_vote", input: { winner: "anthropic", reasoning: "better" } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 80, output_tokens: 8 }
      });
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: anthropicMetrics });

    const googleGenerate = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "gog diff", summary: "g", testsAdded: [], filesModified: ["a.ts"] } }]
      }
    }));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: googleMetrics });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });
    await role.run({
      ritualId: "r-obs-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "do something"
    });

    // Check Anthropic registry (developer pass + reviewer pass = 2 successful calls)
    const anthropicMetricsList = await anthropicRegistry.getMetricsAsJSON();
    const anthropicRequestsTotal = anthropicMetricsList.find((m) => m.name === "atlas_llm_provider_requests_total");
    expect(anthropicRequestsTotal).toBeDefined();
    const anthropicValues = (anthropicRequestsTotal as { values: Array<{ labels: Record<string, string>; value: number }> }).values;
    const totalAnthropicSuccesses = anthropicValues.filter((v) => v.labels.status === "success").reduce((acc, v) => acc + v.value, 0);
    expect(totalAnthropicSuccesses).toBeGreaterThanOrEqual(2);

    // Check Google registry (developer pass = 1 successful call)
    const googleMetricsList = await googleRegistry.getMetricsAsJSON();
    const googleRequestsTotal = googleMetricsList.find((m) => m.name === "atlas_llm_provider_requests_total");
    expect(googleRequestsTotal).toBeDefined();
    const googleValues = (googleRequestsTotal as { values: Array<{ labels: Record<string, string>; value: number }> }).values;
    const totalGoogleSuccesses = googleValues.filter((v) => v.labels.status === "success").reduce((acc, v) => acc + v.value, 0);
    expect(totalGoogleSuccesses).toBeGreaterThanOrEqual(1);
  });
});
