import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole.run (google fails, anthropic wins by walkover)", () => {
  it("Anthropic wins; no reviewer call; emits developer.walkover with picked=anthropic", async () => {
    const anthropicCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output", input: { diff: "anth diff", summary: "anthropic wins", testsAdded: [], filesModified: ["a.ts"] } }],
      model: "claude-sonnet-4-6", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 }
    }));
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    const googleGenerate = vi.fn().mockRejectedValue(new Error("Gemini is down"));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });
    const out = await role.run({
      ritualId: "r-walkover-2",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "do something"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("developer.google.failed");
    expect(types).toContain("developer.anthropic.completed");
    expect(types).toContain("developer.walkover");
    expect(types).not.toContain("developer.reviewer.voted");
    expect(out.diff.body).toBe("anth diff");

    const walkoverEvent = out.events.find((e) => e.eventType === "developer.walkover");
    expect(walkoverEvent?.payload?.picked).toBe("anthropic");

    // No reviewer call: no reviewer.voted event means reviewer was never invoked
    expect(types).not.toContain("developer.reviewer.voted");
  });
});
