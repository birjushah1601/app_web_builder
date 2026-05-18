import { BUILD_COMMANDS, type BuildCommand, type KnownTemplate } from "./commands.js";
import { parseTscOutput, parsePyrightJson } from "./parse.js";
import { SandboxUnreachableError, type SandboxExec } from "./sandbox-exec.js";
import type { BuildError, BuildErrorKind, BuildReport } from "./schema.js";

export interface BuildGateRoleOptions {
  /**
   * Template name. Accept any string at the type level so atlas-web can
   * pass through whatever `template-router.ts` returned; the role guards
   * unknown templates at runtime by emitting errorKind: "unsupported_stack".
   */
  template: string;
  exec: SandboxExec;
}

export class BuildGateRole {
  static readonly roleId = "build-gate" as const;
  readonly roleId = BuildGateRole.roleId;

  private readonly template: string;
  private readonly exec: SandboxExec;

  constructor(opts: BuildGateRoleOptions) {
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

    // Non-zero exit. Parse with the template's parser. tsc writes errors to
    // stdout; pyright writes JSON to stdout. We pass stdout to the parser
    // for both. On parser miss, synthesize a single error from stderr/stdout.
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

function tailString(s: string, max = 4096): string {
  if (s.length <= max) return s;
  return s.slice(s.length - max);
}
