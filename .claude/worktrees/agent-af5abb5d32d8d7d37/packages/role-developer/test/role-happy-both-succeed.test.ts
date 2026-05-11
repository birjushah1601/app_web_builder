import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole.run (both providers succeed)", () => {
  it("dispatches both providers in parallel and emits reviewer.voted + completed", async () => {
    const anthropicCreate = vi.fn()
      // Developer Anthropic pass
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output", input: { diff: "anth diff", summary: "a", testsAdded: ["t1.ts"], filesModified: ["a.ts"] } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 }
      })
      // Reviewer pass
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu2", name: "emit_reviewer_vote", input: { winner: "anthropic", reasoning: "tighter test" } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 80, output_tokens: 8 }
      });
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    const googleGenerate = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "emit_developer_output", args: { diff: "gog diff", summary: "g", testsAdded: ["t2.ts"], filesModified: ["a.ts"] } } }] } }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "gog diff", summary: "g", testsAdded: ["t2.ts"], filesModified: ["a.ts"] } }]
      }
    }));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });
    const out = await role.run({
      ritualId: "r-d-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "rename foo to bar"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("developer.dispatch.started");
    expect(types).toContain("developer.anthropic.completed");
    expect(types).toContain("developer.google.completed");
    expect(types).toContain("developer.reviewer.voted");
    expect(types).toContain("developer.completed");
    expect(out.diff.kind).toBe("patch");
    expect(out.diff.body).toBe("anth diff"); // reviewer picked anthropic
  });
});
