import { describe, it, expect, vi } from "vitest";
import { VisualQualityGateRunner } from "../src/runner.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const fakeSkills = { get: () => ({ body: "x" }) } as unknown as { get(n: string): { body: string } | undefined };
const fakeExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "B64", exitCode: 0 }) };

describe("VisualQualityGateRunner", () => {
  it("has layer = 'L7'", () => {
    const runner = new VisualQualityGateRunner({ llm: fakeLLM({}) as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "x" });
    expect(runner.layer).toBe("L7");
  });

  it("returns GateResult.passed=true on green report", async () => {
    const llm = fakeLLM({ passed: true, score: 90, issues: [], screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" } });
    const runner = new VisualQualityGateRunner({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const result = await runner.run({ tokens: {} });
    expect(result.passed).toBe(true);
    expect(result.report.score).toBe(90);
  });

  it("returns GateResult.passed=false on red report", async () => {
    const llm = fakeLLM({
      passed: false,
      score: 40,
      issues: [{ severity: "critical", category: "design-token-drift", message: "wrong palette" }],
      screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" }
    });
    const runner = new VisualQualityGateRunner({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const result = await runner.run({ tokens: {} });
    expect(result.passed).toBe(false);
    expect(result.report.issues[0]?.severity).toBe("critical");
  });
});
