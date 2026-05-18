import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { BUILD_COMMANDS, type BuildCommand, type KnownTemplate } from "./commands.js";
import { parseTscOutput, parsePyrightJson } from "./parse.js";
import { SandboxUnreachableError, type SandboxExec } from "./sandbox-exec.js";
import type { BuildError, BuildErrorKind, BuildReport } from "./schema.js";

export interface BuildCheckOptions {
  /**
   * Template name. Accept any string at the type level so atlas-web can
   * pass through whatever `template-router.ts` returned; the check guards
   * unknown templates at runtime by emitting errorKind: "unsupported_stack".
   */
  template: string;
  exec: SandboxExec;
}

/**
 * Pure build-check logic. Runs the registered build command via the
 * injected SandboxExec, parses output, returns a structured BuildReport.
 * Never throws — every failure surfaces as a typed errorKind.
 *
 * Unit-tested in test/role.test.ts. Wrapped by BuildGateRole for use as
 * a conductor Role.
 */
export class BuildCheck {
  private readonly template: string;
  private readonly exec: SandboxExec;

  constructor(opts: BuildCheckOptions) {
    this.template = opts.template;
    this.exec = opts.exec;
  }

  async run(): Promise<BuildReport> {
    const start = Date.now();
    const cmd: BuildCommand | undefined = BUILD_COMMANDS[this.template as KnownTemplate];
    if (!cmd) {
      return {
        passed: false,
        errorKind: "unsupported_stack",
        template: this.template,
        command: "",
        exitCode: null,
        durationMs: Date.now() - start,
        errors: [{ file: "?", line: 0, col: 0, severity: "error", message: `No build command registered for template "${this.template}"` }]
      };
    }

    let exitCode: number;
    let stdout: string;
    let stderr: string;
    let timedOut: boolean;
    try {
      const result = await this.exec.runCommand({ cmd: cmd.exec, timeoutMs: cmd.timeoutMs });
      exitCode = result.exitCode;
      stdout = result.stdout;
      stderr = result.stderr;
      timedOut = result.timedOut;
    } catch (err) {
      const cause = err instanceof SandboxUnreachableError ? err.cause : err;
      return {
        passed: false,
        errorKind: "sandbox_unreachable",
        template: this.template,
        command: cmd.exec,
        exitCode: null,
        durationMs: Date.now() - start,
        errors: [{ file: "?", line: 0, col: 0, severity: "error", message: `Sandbox unreachable: ${cause instanceof Error ? cause.message : String(cause)}` }]
      };
    }

    const durationMs = Date.now() - start;

    if (timedOut) {
      return {
        passed: false,
        errorKind: "timeout",
        template: this.template,
        command: cmd.exec,
        exitCode,
        durationMs,
        errors: [{ file: "?", line: 0, col: 0, severity: "error", message: `Build command timed out after ${cmd.timeoutMs}ms` }],
        rawTail: tailString(stderr)
      };
    }

    if (exitCode === 0) {
      return {
        passed: true,
        errorKind: "none",
        template: this.template,
        command: cmd.exec,
        exitCode,
        durationMs,
        errors: []
      };
    }

    const parsed: BuildError[] =
      cmd.parser === "tsc" ? parseTscOutput(stdout) : parsePyrightJson(stdout);

    const errorKind: BuildErrorKind = cmd.parser === "tsc" ? "compile" : "type";

    const errors: BuildError[] = parsed.length > 0
      ? parsed
      : [{ file: "?", line: 0, col: 0, severity: "error", message: stderr.trim() || stdout.trim() || `Build failed (exit ${exitCode}) with no parseable output` }];

    return {
      passed: false,
      errorKind,
      template: this.template,
      command: cmd.exec,
      exitCode,
      durationMs,
      errors,
      rawTail: tailString(stderr)
    };
  }
}

export interface BuildGateRoleOptions extends BuildCheckOptions {}

/**
 * Conductor adapter around BuildCheck. Implements Role; emits
 *   build-gate.started → build-gate.passed | build-gate.failed → build-gate.completed
 * matching the @atlas/role-security pattern. The .completed event carries
 *   payload: { passed: boolean; report: BuildReport }
 * so the ritual-engine's chain-failure detector can read passed/report
 * without any new conductor surface.
 *
 * Returns RoleOutput.diff = { kind: "none" } — gates don't produce code
 * changes; auto-fix re-runs the architect/developer with the report folded
 * into priorArtifact (wired separately in the engine).
 */
export class BuildGateRole implements Role {
  readonly id = "build-gate";
  private readonly check: BuildCheck;
  private readonly template: string;

  constructor(opts: BuildGateRoleOptions) {
    this.check = new BuildCheck(opts);
    this.template = opts.template;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({
      eventType: "build-gate.started",
      payload: { ritualId: inv.ritualId, template: this.template }
    });

    try {
      const report = await this.check.run();
      if (report.passed) {
        events.push({
          eventType: "build-gate.passed",
          payload: { durationMs: report.durationMs, template: report.template, command: report.command }
        });
      } else {
        events.push({
          eventType: "build-gate.failed",
          payload: {
            errorKind: report.errorKind,
            errorCount: report.errors.length,
            durationMs: report.durationMs,
            template: report.template,
            command: report.command
          }
        });
      }
      events.push({
        eventType: "build-gate.completed",
        payload: { passed: report.passed, report }
      });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      events.push({
        eventType: "build-gate.errored",
        payload: { error: (err as Error).message }
      });
      throw err;
    }
  }
}

function tailString(s: string, max = 4096): string {
  if (s.length <= max) return s;
  return s.slice(s.length - max);
}
