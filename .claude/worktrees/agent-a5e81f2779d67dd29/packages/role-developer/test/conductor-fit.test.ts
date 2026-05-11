import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { Conductor } from "@atlas/conductor";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole satisfies @atlas/conductor's Role interface", () => {
  it("Conductor.dispatch with roleId=developer returns diff + events via DeveloperRole", async () => {
    // Anthropic: first call is the developer pass, second call is the reviewer pass
    const anthropicCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output",
          input: { diff: "@@ -1 +1 @@\n-foo\n+bar\n", summary: "renamed foo to bar", testsAdded: ["test/rename.test.ts"], filesModified: ["src/foo.ts"] } }],
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 }
      })
      // Reviewer pass
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu2", name: "emit_reviewer_vote",
          input: { winner: "anthropic", reasoning: "tighter test coverage and minimal diff" } }],
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        usage: { input_tokens: 80, output_tokens: 10 }
      });
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    // Google: developer pass
    const googleGenerate = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "emit_developer_output", args: { diff: "@@ -1 +1 @@\n-foo\n+baz\n", summary: "renamed foo to baz", testsAdded: [], filesModified: ["src/foo.ts"] } } }] } }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "@@ -1 +1 @@\n-foo\n+baz\n", summary: "renamed foo to baz", testsAdded: [], filesModified: ["src/foo.ts"] } }]
      }
    }));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });

    const checkpoints: Array<{ eventType: string }> = [];
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 0.92 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (e) => { checkpoints.push(e); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const result = await conductor.dispatch({
      ritualId: "r-dev-fit" as never,
      graphVersion: 1,
      userTurn: "rename foo to bar",
      projectId: "22222222-2222-4222-8222-222222222222"
    });

    expect(result.roleId).toBe("developer");
    expect(result.attempts).toBe(1);

    // The conductor emits checkpoint events; DeveloperRole emits role events on the output
    const checkpointTypes = checkpoints.map((c) => c.eventType);
    expect(checkpointTypes).toContain("dispatch.classified");
    expect(checkpointTypes).toContain("dispatch.completed");

    // Role output carries the diff + events
    expect(result.output.diff.kind).toBe("patch");
    expect(result.output.diff.body).toBe("@@ -1 +1 @@\n-foo\n+bar\n"); // reviewer picked anthropic
    const roleEventTypes = result.output.events.map((e) => e.eventType);
    expect(roleEventTypes).toContain("developer.dispatch.started");
    expect(roleEventTypes).toContain("developer.anthropic.completed");
    expect(roleEventTypes).toContain("developer.google.completed");
    expect(roleEventTypes).toContain("developer.reviewer.voted");
    expect(roleEventTypes).toContain("developer.completed");
  });
});
