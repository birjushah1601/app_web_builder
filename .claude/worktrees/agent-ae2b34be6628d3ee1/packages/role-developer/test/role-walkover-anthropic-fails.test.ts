import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole.run (anthropic fails, google wins by walkover)", () => {
  it("Google wins; no reviewer call; emits developer.walkover with picked=google", async () => {
    // Anthropic throws; reviewer should NOT be called (still using same SDK but tracking calls)
    const anthropicCreate = vi.fn().mockRejectedValue(new Error("Anthropic is down"));
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    const googleGenerate = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "gog diff", summary: "google wins", testsAdded: [], filesModified: ["a.ts"] } }]
      }
    }));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });
    const out = await role.run({
      ritualId: "r-walkover-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "do something"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("developer.anthropic.failed");
    expect(types).toContain("developer.google.completed");
    expect(types).toContain("developer.walkover");
    expect(types).not.toContain("developer.reviewer.voted");
    expect(out.diff.body).toBe("gog diff");

    const walkoverEvent = out.events.find((e) => e.eventType === "developer.walkover");
    expect(walkoverEvent?.payload?.picked).toBe("google");

    // No reviewer call: anthropicCreate was only called for the developer pass (retries), NOT for reviewer
    // The reviewer would add an extra call AFTER both pass results are known; since google won by walkover,
    // no reviewer call happens. We verify by checking the event types above.
    expect(types).not.toContain("developer.reviewer.voted");
  });
});
