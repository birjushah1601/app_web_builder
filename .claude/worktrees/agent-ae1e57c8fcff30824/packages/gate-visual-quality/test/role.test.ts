import { describe, it, expect, vi } from "vitest";
import { VisualQualityRole } from "../src/role.js";
import type { RoleInvocation } from "@atlas/conductor";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_visual_quality_report", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const fakeSkills = { get: () => ({ body: "x" }) } as unknown as { get(n: string): { body: string } | undefined };

const baseInvocation = (priorArtifact?: unknown): RoleInvocation => {
  const inv: RoleInvocation = {
    ritualId: "r1",
    intent: "test",
    userTurn: "diff",
    graphSlice: { bytes: "{}", hash: "h" }
  };
  if (priorArtifact !== undefined) {
    return { ...inv, priorArtifact };
  }
  return inv;
};

const designBlockingArtifact = {
  canvasManifest: {
    artifactKind: "frontend-page",
    modes: [{ id: "design", renderer: "x", audience: ["ama"], blockingFor: "design" }]
  }
};

const validReport = (passed = true) => ({
  passed,
  score: passed ? 90 : 50,
  issues: passed ? [] : [{ severity: "critical", category: "design-token-drift", message: "wrong palette" }],
  screenshotUrls: { desktop: "x", tablet: "x", mobile: "x" }
});

describe("VisualQualityRole", () => {
  it("has id 'visual-quality'", () => {
    const fakeExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "B64", exitCode: 0 }) };
    const role = new VisualQualityRole({ llm: fakeLLM(validReport()) as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "x" });
    expect(role.id).toBe("visual-quality");
  });

  it("emits started + passed + completed on green", async () => {
    const fakeExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "B64", exitCode: 0 }) };
    const llm = fakeLLM(validReport(true));
    const role = new VisualQualityRole({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const out = await role.run(baseInvocation(designBlockingArtifact));
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("visual_quality.started");
    expect(types).toContain("visual_quality.passed");
    expect(types).toContain("visual_quality.completed");
  });

  it("emits started + failed + completed on red", async () => {
    const fakeExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "B64", exitCode: 0 }) };
    const llm = fakeLLM(validReport(false));
    const role = new VisualQualityRole({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    const out = await role.run(baseInvocation(designBlockingArtifact));
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("visual_quality.failed");
  });

  it("emits skipped + completed when canvasManifest has no design-blocking mode", async () => {
    const fakeExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "B64", exitCode: 0 }) };
    const llm = fakeLLM(validReport());
    const role = new VisualQualityRole({ llm: llm as never, skills: fakeSkills as never, exec: fakeExec as never, previewUrl: "http://localhost:3000" });
    // Pass priorArtifact with backend-only canvas (no design mode)
    const out = await role.run(baseInvocation({ canvasManifest: { artifactKind: "backend-rest-api", modes: [{ id: "schema", renderer: "x", audience: ["diego"] }] } }));
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("visual_quality.skipped");
    expect(types).not.toContain("visual_quality.passed");
    expect(types).not.toContain("visual_quality.failed");
  });

  it("emits errored on internal failure", async () => {
    const failingExec = { runCommand: vi.fn().mockResolvedValue({ stdout: "", exitCode: 1, stderr: "x" }) };
    const role = new VisualQualityRole({ llm: fakeLLM(validReport()) as never, skills: fakeSkills as never, exec: failingExec as never, previewUrl: "http://localhost:3000" });
    await expect(role.run(baseInvocation(designBlockingArtifact))).rejects.toThrow();
  });
});
