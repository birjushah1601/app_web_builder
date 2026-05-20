import { describe, it, expect, vi } from "vitest";
import { runVisualQualityCheck } from "../src/visual-quality-check.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const fakeRegistry = {
  get(name: string) {
    return { body: `BODY-${name}` };
  }
} as unknown as { get(name: string): { body: string } | undefined };

const fakeExec = {
  runCommand: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd.includes("desktop")) return { stdout: "DESKTOP_B64", exitCode: 0 };
    if (cmd.includes("tablet")) return { stdout: "TABLET_B64", exitCode: 0 };
    if (cmd.includes("mobile")) return { stdout: "MOBILE_B64", exitCode: 0 };
    return { stdout: "", exitCode: 0 };
  })
};

describe("runVisualQualityCheck", () => {
  it("composes screenshots → critique → returns report", async () => {
    const llm = fakeLLM({ passed: true, score: 90, issues: [], screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" } });
    const report = await runVisualQualityCheck({
      llm: llm as never,
      skills: fakeRegistry as never,
      exec: fakeExec as never,
      previewUrl: "http://localhost:3000",
      tokens: {}
    });
    expect(report.passed).toBe(true);
    expect(report.score).toBe(90);
    expect(report.screenshotUrls.desktop).toContain("DESKTOP_B64");
  });

  it("propagates ScreenshotFailedError", async () => {
    const failingExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "", exitCode: 1, stderr: "x" }) };
    const llm = fakeLLM({});
    await expect(
      runVisualQualityCheck({
        llm: llm as never,
        skills: fakeRegistry as never,
        exec: failingExec as never,
        previewUrl: "http://localhost:3000",
        tokens: {}
      })
    ).rejects.toThrow(/screenshot failed/);
  });

  it("propagates VisualQualityError on LLM failure", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    };
    await expect(
      runVisualQualityCheck({
        llm: llm as never,
        skills: fakeRegistry as never,
        exec: fakeExec as never,
        previewUrl: "http://localhost:3000",
        tokens: {}
      })
    ).rejects.toThrow();
  });
});
