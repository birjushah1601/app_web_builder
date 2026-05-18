import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { runSecurityCheck, SECURITY_MODEL } from "../src/security-check.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("runSecurityCheck", () => {
  it("returns passed=true when the model reports no issues", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: { passed: true, issues: [], skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"] } }],
      model: SECURITY_MODEL, stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const report = await runSecurityCheck({ llm, skills, diff: "@@ trivial", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });
    expect(report.passed).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.skillsRun).toContain("audit-rls");
  });

  it("returns passed=false when the model emits a critical issue", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: {
          passed: false,
          issues: [{ severity: "critical", code: "SEC-RLS-001", message: "Model missing rlsPolicies.select" }],
          skillsRun: ["audit-rls"]
        } }],
      model: SECURITY_MODEL, stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 30 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const report = await runSecurityCheck({ llm, skills, diff: "@@", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });
    expect(report.passed).toBe(false);
    expect(report.issues[0].severity).toBe("critical");
  });
});
