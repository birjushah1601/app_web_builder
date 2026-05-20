import { describe, it, expect, vi } from "vitest";
import { E2BExec } from "../src/exec.js";
import type { SandboxExec } from "../src/exec.js";
import { SandboxIdSchema } from "../src/types.js";

const SANDBOX_ID = SandboxIdSchema.parse("sbx_exec_test");

function makeMockProcess(stdout: string, stderr: string, exitCode: number) {
  return {
    wait: vi.fn().mockResolvedValue({ exitCode }),
    stdout: { pipe: vi.fn() },
    stderr: { pipe: vi.fn() },
    output: { stdout, stderr },
  };
}

function makeMockSdkCommands(process: ReturnType<typeof makeMockProcess>) {
  return {
    run: vi.fn().mockResolvedValue(process),
    runBackground: vi.fn().mockResolvedValue(process),
  };
}

describe("E2BExec", () => {
  it("runCommand accumulates stdout, stderr, and exitCode", async () => {
    const proc = makeMockProcess("hello world\n", "", 0);
    const mockCommands = makeMockSdkCommands(proc);
    const registry = new Map([[SANDBOX_ID as string, { commands: mockCommands }]]);
    const exec: SandboxExec = new E2BExec(registry);
    const result = await exec.runCommand(SANDBOX_ID, "echo hello world");
    expect(result.stdout).toContain("hello world");
    expect(result.exitCode).toBe(0);
    expect(mockCommands.run).toHaveBeenCalledWith("echo hello world", expect.any(Object));
  });

  it("runCommand surfaces non-zero exit code", async () => {
    const proc = makeMockProcess("", "command not found\n", 127);
    const mockCommands = makeMockSdkCommands(proc);
    const registry = new Map([[SANDBOX_ID as string, { commands: mockCommands }]]);
    const exec: SandboxExec = new E2BExec(registry);
    const result = await exec.runCommand(SANDBOX_ID, "notacommand");
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("command not found");
  });

  it("throws SandboxNotFoundError for unknown sandbox id", async () => {
    const exec: SandboxExec = new E2BExec(new Map());
    await expect(
      exec.runCommand(SandboxIdSchema.parse("sbx_ghost"), "ls")
    ).rejects.toThrow("SandboxNotFoundError");
  });

  it("streamCommand yields stdout chunks from an AsyncIterable source", async () => {
    async function* fakeStream() {
      yield { stream: "stdout" as const, data: "chunk1\n" };
      yield { stream: "stdout" as const, data: "chunk2\n" };
    }
    const mockCommands = {
      run: vi.fn(),
      runBackground: vi.fn(),
      streamRun: vi.fn().mockReturnValue(fakeStream()),
    };
    const registry = new Map([[SANDBOX_ID as string, { commands: mockCommands }]]);
    const exec: SandboxExec = new E2BExec(registry);
    const chunks: string[] = [];
    for await (const chunk of exec.streamCommand(SANDBOX_ID, "npm run dev")) {
      if (chunk.stream === "stdout") chunks.push(chunk.data);
    }
    expect(chunks).toEqual(["chunk1\n", "chunk2\n"]);
  });
});
