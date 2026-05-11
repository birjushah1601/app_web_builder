"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getSandboxFactory } from "@/lib/sandbox/factory";

export interface RunTerminalCommandInput {
  projectId: string;
  command: string;
}

export interface RunTerminalCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Hard cap on the command string forwarded to the sandbox. Caller-side
 *  guard against pathological input — anything past 4 KB is almost certainly
 *  not a real shell command and would only burn sandbox CPU. */
const MAX_COMMAND_BYTES = 4 * 1024;

/** Minimal SDK shape we depend on. The real `@e2b/sdk` Sandbox object exposes
 *  many more methods; narrowing here keeps the cast in resolveSandboxSdk()
 *  honest. */
interface SandboxSdkLike {
  commands: {
    run(
      cmd: string,
      opts?: { timeoutMs?: number; background?: false }
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
}

/**
 * Connects to the project's E2B sandbox and runs a single shell command.
 * Synchronous-ish: one command in, one structured `{stdout, stderr, exitCode}`
 * out. No streaming, no WebSocket bridge. The TerminalPane formats the result
 * for display.
 *
 * Errors:
 *   - UNAUTHORIZED → no signed-in user
 *   - COMMAND_TOO_LARGE → input.command > 4 KB
 *   - Anything thrown by the sandbox factory or `commands.run` propagates
 *     verbatim so the caller can surface a helpful message.
 */
export async function runTerminalCommand(
  input: RunTerminalCommandInput
): Promise<RunTerminalCommandResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const command = input.command;
  // Byte cap (UTF-8). String.length is UTF-16 code units; for an ASCII-heavy
  // shell command it overestimates by ~0; for multibyte input it
  // *underestimates* the byte count, so we use Buffer.byteLength to be
  // truthful about the cap.
  if (Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) {
    throw new Error("COMMAND_TOO_LARGE");
  }

  const session = await getSandboxFactory().getOrProvision(input.projectId);
  const { Sandbox } = await import("@e2b/sdk");
  const sdk = (await Sandbox.connect(session.record.sandboxId, {
    apiKey: process.env.E2B_API_KEY ?? ""
  })) as unknown as SandboxSdkLike;

  // E2B SDK v2.5+ Commands API:
  //   sdk.commands.run(cmd, { timeoutMs, background: false })
  //   → { stdout, stderr, exitCode }
  // 60s timeout matches the Plan E.4 contract — long enough for a typical
  // build/test command, short enough that a runaway process doesn't hang
  // the UI.
  const result = await sdk.commands.run(command, { timeoutMs: 60_000 });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}
