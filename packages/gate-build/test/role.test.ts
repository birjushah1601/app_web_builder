import { describe, it, expect, vi } from "vitest";
import { BuildGateRole } from "../src/role";
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

describe("BuildGateRole", () => {
  it("emits passed=true when exit code is 0", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 0, stdout: "Found 0 errors.\n" }) });
    const report = await role.run();
    expect(report.passed).toBe(true);
    expect(report.errorKind).toBe("none");
    expect(report.errors).toEqual([]);
    expect(report.command).toBe("pnpm exec tsc --noEmit");
    expect(report.template).toBe("atlas-next-ts-v2");
  });

  it("emits passed=false errorKind='compile' on non-zero exit with tsc errors in stdout", async () => {
    const stdout = `src/app/page.tsx(288,99): error TS1005: Expected '</', got 'm'.\n`;
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stdout }) });
    const report = await role.run();
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
    const role = new BuildGateRole({ template: "atlas-fastapi", exec: makeExec({ exitCode: 1, stdout: json }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("type");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].line).toBe(10); // 0-based → 1-based
  });

  it("emits errorKind='timeout' when SandboxExec reports timedOut", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 124, stdout: "", timedOut: true }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("timeout");
  });

  it("emits errorKind='sandbox_unreachable' when SandboxExec throws", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ throws: new Error("ECONNREFUSED") }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("sandbox_unreachable");
    expect(report.exitCode).toBeNull();
    expect(report.errors[0].message).toContain("ECONNREFUSED");
  });

  it("emits errorKind='unsupported_stack' for an unknown template", async () => {
    const role = new BuildGateRole({ template: "atlas-unknown", exec: makeExec({}) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errorKind).toBe("unsupported_stack");
  });

  it("includes rawTail (last 4KB of stderr) on failure for human debugging", async () => {
    const stderr = "a".repeat(5000);
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stderr }) });
    const report = await role.run();
    expect(report.rawTail?.length).toBeLessThanOrEqual(4096);
    expect(report.rawTail?.endsWith("a")).toBe(true);
  });

  it("falls back to a synthetic single error when parser returns [] but exit code is non-zero", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({ exitCode: 1, stdout: "some unparseable junk", stderr: "boom" }) });
    const report = await role.run();
    expect(report.passed).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain("boom");
  });

  it("emits durationMs as a non-negative integer", async () => {
    const role = new BuildGateRole({ template: "atlas-next-ts-v2", exec: makeExec({}) });
    const report = await role.run();
    expect(Number.isInteger(report.durationMs)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
