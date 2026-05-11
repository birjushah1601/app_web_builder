import type { SandboxId } from "./types.js";
import { SandboxNotFoundError } from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecChunk {
  stream: "stdout" | "stderr";
  data: string;
}

export interface SandboxExec {
  runCommand(sandboxId: SandboxId, cmd: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>;
  streamCommand(sandboxId: SandboxId, cmd: string, opts?: { cwd?: string }): AsyncIterable<ExecChunk>;
}

interface SdkProcess {
  exitCode?: number;
  output: { stdout: string; stderr: string };
  wait?(): Promise<{ exitCode: number }>;
}

interface SdkCommands {
  run(cmd: string, opts?: object): Promise<SdkProcess>;
  streamRun?(cmd: string, opts?: object): AsyncIterable<ExecChunk>;
}

interface SdkEntry {
  commands: SdkCommands;
}

export class E2BExec implements SandboxExec {
  private readonly registry: Map<string, SdkEntry>;

  constructor(registry: Map<string, SdkEntry>) {
    this.registry = registry;
  }

  private sdk(sandboxId: SandboxId): SdkCommands {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    return entry.commands;
  }

  async runCommand(
    sandboxId: SandboxId,
    cmd: string,
    opts?: { cwd?: string; timeoutMs?: number }
  ): Promise<ExecResult> {
    const sdk = this.sdk(sandboxId);
    const result = await sdk.run(cmd, {
      cwd: opts?.cwd,
      timeout: opts?.timeoutMs,
    });
    // Support both: direct exitCode (real SDK) and wait()-based exitCode (test mocks)
    let exitCode = result.exitCode;
    if (exitCode === undefined && result.wait) {
      const waited = await result.wait();
      exitCode = waited.exitCode;
    }
    return {
      stdout: result.output.stdout,
      stderr: result.output.stderr,
      exitCode: exitCode ?? 0,
    };
  }

  async *streamCommand(
    sandboxId: SandboxId,
    cmd: string,
    opts?: { cwd?: string }
  ): AsyncIterable<ExecChunk> {
    const sdk = this.sdk(sandboxId);
    if (!sdk.streamRun) {
      throw new Error(
        `E2BExec: SDK commands object for ${sandboxId} does not support streamRun`
      );
    }
    yield* sdk.streamRun(cmd, { cwd: opts?.cwd });
  }
}
