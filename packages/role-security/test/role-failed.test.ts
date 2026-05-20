import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { SecurityRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("SecurityRole.run (failed)", () => {
  it("emits security.failed with critical count when model returns critical issue", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: {
          passed: false,
          issues: [
            { severity: "critical", code: "SEC-RLS-001", message: "Model missing rlsPolicies.select" },
            { severity: "high", code: "SEC-CORS-003", message: "Wildcard CORS on credentialed route" }
          ],
          skillsRun: ["audit-rls", "cors-policy"]
        } }],
      model: "claude-opus-4-7", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 40 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new SecurityRole({ llm, skills });

    const out = await role.run({
      ritualId: "r-sec-fail",
      intent: "security",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "check this diff"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("security.started");
    expect(types).toContain("security.failed");
    expect(types).toContain("security.completed");
    expect(out.diff.kind).toBe("none");

    const failedEvent = out.events.find((e) => e.eventType === "security.failed");
    expect((failedEvent?.payload as { critical: number }).critical).toBe(1);
    expect((failedEvent?.payload as { total: number }).total).toBe(2);

    const completed = out.events.find((e) => e.eventType === "security.completed");
    expect((completed?.payload as { passed: boolean }).passed).toBe(false);
  });

  it("does not throw on failed security check — caller decides policy", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: { passed: false, issues: [{ severity: "critical", code: "SEC-SCRT-001", message: "Hardcoded token" }], skillsRun: ["secrets-scan"] } }],
      model: "claude-opus-4-7", stop_reason: "tool_use",
      usage: { input_tokens: 80, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new SecurityRole({ llm, skills });

    // Should resolve normally, not reject
    await expect(role.run({
      ritualId: "r-sec-nothrow",
      intent: "security",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "diff with secret"
    })).resolves.toBeDefined();
  });
});
