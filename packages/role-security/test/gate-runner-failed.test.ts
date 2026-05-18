import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { SecurityGateRunner } from "../src/gate-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("SecurityGateRunner (failed)", () => {
  it("returns status=failed and summary mentions critical count when model emits critical issues", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: {
          passed: false,
          issues: [
            { severity: "critical", code: "SEC-RLS-001", message: "Model missing rlsPolicies.select" },
            { severity: "critical", code: "SEC-SCRT-001", message: "Hardcoded API token in diff" },
            { severity: "high", code: "SEC-CORS-003", message: "Wildcard CORS" }
          ],
          skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"]
        } }],
      model: "claude-opus-4-7", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const runner = new SecurityGateRunner({ llm, skills });

    const result = await runner.run({
      ritualId: "r-gate-fail",
      projectId: "11111111-1111-4111-8111-111111111111",
      commitSha: "deadbeef",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    });

    expect(result.layer).toBe("L4");
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("2 critical");
    expect(result.issues).toBeDefined();
    expect(result.issues?.some((i) => i.severity === "critical")).toBe(true);
  });
});
