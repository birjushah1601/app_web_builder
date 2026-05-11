import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { SecurityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("SecurityRole.run (passed)", () => {
  it("returns role output with security.passed event when no critical issues", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: { passed: true, issues: [], skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"] } }],
      model: "claude-opus-4-7", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new SecurityRole({ llm, skills });

    const out = await role.run({
      ritualId: "r-sec-1",
      intent: "security",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "check this diff"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("security.started");
    expect(types).toContain("security.passed");
    expect(types).toContain("security.completed");
    expect(out.diff.kind).toBe("none");

    const completed = out.events.find((e) => e.eventType === "security.completed");
    expect((completed?.payload as { passed: boolean }).passed).toBe(true);
  });
});
