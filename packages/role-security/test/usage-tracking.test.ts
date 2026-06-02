import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { SecurityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

/**
 * Plan G.4 Task 3 — SecurityRole records token usage tagged with
 * roleId="security" after the security-check LLM call.
 */
describe("SecurityRole — usageTracker.record (Plan G.4 Task 3)", () => {
  it("records usage tagged roleId='security' after runSecurityCheck completes", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{
        type: "tool_use", id: "tu", name: "emit_security_report",
        input: { passed: true, issues: [], skillsRun: ["audit-rls"] }
      }],
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 75 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const record = vi.fn();
    const role = new SecurityRole({ llm, skills });
    await role.run({
      ritualId: "r1",
      intent: "security",
      userTurn: "diff --git",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      usageTracker: { record }
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 500, outputTokens: 75 },
      { roleId: "security" }
    );
  });
});
