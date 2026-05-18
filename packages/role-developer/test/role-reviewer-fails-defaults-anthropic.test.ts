import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole.run (reviewer fails, defaults to Anthropic)", () => {
  it("emits developer.reviewer.failed_defaulting_anthropic and uses anthropic diff", async () => {
    const anthropicCreate = vi.fn()
      // Developer Anthropic pass succeeds
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output", input: { diff: "anth diff", summary: "anthropic summary", testsAdded: [], filesModified: ["a.ts"] } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 }
      })
      // Reviewer call fails
      .mockRejectedValueOnce(new Error("Reviewer is down"));

    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    const googleGenerate = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "gog diff", summary: "google summary", testsAdded: [], filesModified: ["a.ts"] } }]
      }
    }));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });
    const out = await role.run({
      ritualId: "r-reviewer-fail",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "do something"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("developer.reviewer.failed_defaulting_anthropic");
    expect(types).not.toContain("developer.reviewer.voted");
    expect(out.diff.body).toBe("anth diff");
    expect(out.diff.kind).toBe("patch");
  });
});
