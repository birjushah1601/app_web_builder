import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { BrowserVerificationRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("BrowserVerificationRole — usageTracker.record (Plan G.4 Task 3)", () => {
  it("records usage tagged roleId='browser-verification' after the LLM call", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{
        type: "tool_use", id: "tu", name: "emit_browser_verification_report",
        input: { passed: true, issues: [], skillsRun: ["page-load-check"] }
      }],
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      usage: { input_tokens: 333, outputTokens: 0, output_tokens: 44 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const record = vi.fn();
    const role = new BrowserVerificationRole({ llm, skills });
    await role.run({
      ritualId: "r1",
      intent: "browser-verification",
      userTurn: "diff",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      usageTracker: { record }
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 333, outputTokens: 44 },
      { roleId: "browser-verification" }
    );
  });
});
