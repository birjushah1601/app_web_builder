import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { SecurityGateRunner } from "../src/gate-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("SecurityGateRunner (passed)", () => {
  it("returns GateResult with status=passed, layer=L4 when SecurityReport.passed", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_security_report",
        input: { passed: true, issues: [], skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"] } }],
      model: "claude-opus-4-7", stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const runner = new SecurityGateRunner({ llm, skills });

    const result = await runner.run({
      ritualId: "r-gate-1",
      projectId: "11111111-1111-4111-8111-111111111111",
      commitSha: "abc1234",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    });

    expect(result.layer).toBe("L4");
    expect(result.status).toBe("passed");
    expect(result.summary).toContain("0");
  });

  it("has layer property equal to L4", () => {
    const llm = {} as never;
    const skills = {} as never;
    const runner = new SecurityGateRunner({ llm, skills });
    expect(runner.layer).toBe("L4");
  });
});
