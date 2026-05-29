import { describe, it, expect, vi } from "vitest";
import { TestsRole } from "../src/role.js";

const VITEST_JSON_OK = JSON.stringify({
  numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0,
  testResults: [{
    name: "__tests__/Home.test.tsx", status: "passed",
    assertionResults: [{ status: "passed", title: "x", duration: 10 }]
  }]
});

describe("TestsRole", () => {
  it("installs vitest, writes generated files, runs the runner, emits a TestsArtifact event", async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd.includes("pnpm add -D")) return { exitCode: 0, stdout: "", stderr: "" };
      if (cmd.includes("vitest run")) return { exitCode: 0, stdout: VITEST_JSON_OK, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const write = vi.fn(async () => {});
    const generateTests = vi.fn(async () => ({
      "__tests__/Home.test.tsx": "import { test } from 'vitest';\ntest('x', () => {});"
    }));

    const role = new TestsRole({ sandbox: { exec, write }, generateTests, frontendNodeId: "frontend" });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: {
        upstream: {
          frontend: { schemaVersion: "1", kind: "frontend-app", pages: [{ route: "/", file: "app/page.tsx" }], designTokens: {}, references: [] }
        }
      }
    });

    const ev = out.events.find((e) => e.eventType === "ritual.artifact_emitted");
    expect(ev).toBeDefined();
    const artifact = (ev?.payload as { artifact: { kind: string; framework: string; specs: unknown[] } }).artifact;
    expect(artifact.kind).toBe("tests");
    expect(artifact.framework).toBe("vitest");
    expect(artifact.specs).toHaveLength(1);
    expect(write).toHaveBeenCalledWith("__tests__/Home.test.tsx", expect.any(String));
  });

  it("emits a failure event when no upstream frontend artifact is found", async () => {
    const role = new TestsRole({
      sandbox: { exec: vi.fn(), write: vi.fn() },
      generateTests: vi.fn(),
      frontendNodeId: "frontend"
    });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: {} }
    });
    expect(out.events.some((e) => e.eventType === "tests.failed")).toBe(true);
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(false);
  });

  it("emits failure when the runner exits non-zero with no parseable output", async () => {
    const role = new TestsRole({
      sandbox: {
        exec: vi.fn(async (cmd: string) => cmd.includes("vitest run")
          ? { exitCode: 1, stdout: "", stderr: "boom" }
          : { exitCode: 0, stdout: "", stderr: "" }),
        write: vi.fn()
      },
      generateTests: vi.fn(async () => ({ "x.test.tsx": "..." })),
      frontendNodeId: "frontend"
    });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: { frontend: { schemaVersion: "1", kind: "frontend-app", pages: [], designTokens: {}, references: [] } } }
    });
    expect(out.events.some((e) => e.eventType === "tests.failed")).toBe(true);
  });
});
