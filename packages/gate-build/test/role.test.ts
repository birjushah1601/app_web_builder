import { describe, it, expect, vi } from "vitest";
import { BuildCheck, BuildGateRole } from "../src/role";
import type { SandboxExec } from "../src/sandbox-exec";

function makeExec(result: Partial<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; throws: unknown }>): SandboxExec {
  return {
    runCommand: vi.fn(async () => {
      if (result.throws) throw result.throws;
      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        timedOut: result.timedOut ?? false
      };
    })
  };
}

const baseInv = {
  ritualId: "r-test",
  intent: "test",
  graphSlice: { bytes: "{}", hash: "sha256:0" },
  userTurn: ""
};

describe("BuildCheck", () => {
  it("emits passed=true when exit code is 0", async () => {
    const check = new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 0, stdout: "Found 0 errors.\n" }) });
    const report = await check.run();
    expect(report.passed).toBe(true);
    expect(report.errorKind).toBe("none");
    expect(report.errors).toEqual([]);
    expect(report.command).toBe("cd /code && pnpm exec tsc --noEmit");
    expect(report.template).toBe("atlas-next-ts-v2");
  });

  it("emits passed=false errorKind='compile' on non-zero exit with tsc errors in stdout", async () => {
    const stdout = `src/app/page.tsx(288,99): error TS1005: Expected '</', got 'm'.\n`;
    const check = new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stdout }) });
    const report = await check.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("compile");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].file).toBe("src/app/page.tsx");
    expect(report.errors[0].line).toBe(288);
  });

  it("emits errorKind='type' for pyright errors", async () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        { file: "/code/app.py", severity: "error", message: "Expected expression", range: { start: { line: 9, character: 4 } } }
      ]
    });
    const check = new BuildCheck({ template: "atlas-fastapi", exec: makeExec({ exitCode: 1, stdout: json }) });
    const report = await check.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("type");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].line).toBe(10);
  });

  it("emits errorKind='timeout' when SandboxExec reports timedOut", async () => {
    const check = new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 124, stdout: "", timedOut: true }) });
    const report = await check.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("timeout");
  });

  it("emits errorKind='sandbox_unreachable' when SandboxExec throws", async () => {
    const check = new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({ throws: new Error("ECONNREFUSED") }) });
    const report = await check.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("sandbox_unreachable");
    expect(report.exitCode).toBeNull();
    expect(report.errors[0].message).toContain("ECONNREFUSED");
  });

  it("emits errorKind='unsupported_stack' for an unknown template", async () => {
    const check = new BuildCheck({ template: "atlas-unknown", exec: makeExec({}) });
    const report = await check.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("unsupported_stack");
  });

  it("includes rawTail (last 4KB of stderr) on failure", async () => {
    const stderr = "a".repeat(5000);
    const check = new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stderr }) });
    const report = await check.run();
    expect(report.rawTail?.length).toBeLessThanOrEqual(4096);
    expect(report.rawTail?.endsWith("a")).toBe(true);
  });

  it("falls back to a synthetic single error when parser returns [] but exit code is non-zero", async () => {
    const check = new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stdout: "some unparseable junk", stderr: "boom" }) });
    const report = await check.run();
    expect(report.passed).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain("boom");
  });

  it("emits durationMs as a non-negative integer", async () => {
    const check = new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({}) });
    const report = await check.run();
    expect(Number.isInteger(report.durationMs)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("BuildGateRole (conductor adapter)", () => {
  it("has id='build-gate'", () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({}) });
    expect(role.id).toBe("build-gate");
  });

  it("on passing check emits started → passed → completed with passed=true and report", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 0 }) });
    const out = await role.run(baseInv);
    expect(out.diff).toEqual({ kind: "none" });
    const types = out.events.map((e) => e.eventType);
    expect(types).toEqual(["build-gate.started", "build-gate.passed", "build-gate.completed"]);
    const completed = out.events.at(-1)!;
    expect(completed.payload.passed).toBe(true);
    expect((completed.payload.report as { passed: boolean }).passed).toBe(true);
  });

  it("on failing check emits started → failed → completed with passed=false and full report", async () => {
    const stdout = `src/app/page.tsx(1,1): error TS1005: nope.\n`;
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stdout }) });
    const out = await role.run(baseInv);
    const types = out.events.map((e) => e.eventType);
    expect(types).toEqual(["build-gate.started", "build-gate.failed", "build-gate.completed"]);
    const completed = out.events.at(-1)!;
    expect(completed.payload.passed).toBe(false);
    expect((completed.payload.report as { errors: unknown[] }).errors).toHaveLength(1);
  });

  it("started event carries ritualId + template", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({}) });
    const out = await role.run({ ...baseInv, ritualId: "r-42" });
    const started = out.events[0];
    expect(started.eventType).toBe("build-gate.started");
    expect(started.payload).toEqual({ ritualId: "r-42", template: "atlas-next-ts-v2" });
  });

  it("completed event payload.report matches BuildCheck output (no info loss)", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 0 }) });
    const checkDirect = await new BuildCheck({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 0 }) }).run();
    const out = await role.run(baseInv);
    const completed = out.events.at(-1)!;
    const reportInEvent = completed.payload.report as typeof checkDirect;
    // Compare shape (durationMs may differ across instances; check structural keys)
    expect(reportInEvent.passed).toBe(checkDirect.passed);
    expect(reportInEvent.errorKind).toBe(checkDirect.errorKind);
    expect(reportInEvent.template).toBe(checkDirect.template);
    expect(reportInEvent.command).toBe(checkDirect.command);
    expect(reportInEvent.errors).toEqual(checkDirect.errors);
  });
});
