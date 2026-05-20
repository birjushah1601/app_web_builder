import { describe, it, expect, vi } from "vitest";
import { E2BFileSystem } from "../src/filesystem.js";
import type { SandboxFileSystem } from "../src/filesystem.js";
import { SandboxIdSchema } from "../src/types.js";

const SANDBOX_ID = SandboxIdSchema.parse("sbx_fs_test");

function makeMockSdkFs(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    read: vi.fn().mockResolvedValue("file contents"),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([
      { name: "index.ts", type: "file", path: "/app/index.ts" },
      { name: "components", type: "dir", path: "/app/components" },
    ]),
    watchDir: vi.fn(),
    ...overrides,
  };
}

function makeSdkRegistry(sandboxId: string, fs: ReturnType<typeof makeMockSdkFs>) {
  return new Map([[sandboxId, { files: fs }]]);
}

describe("E2BFileSystem", () => {
  it("reads a file via the SDK", async () => {
    const mockFs = makeMockSdkFs();
    const fsImpl: SandboxFileSystem = new E2BFileSystem(
      makeSdkRegistry(SANDBOX_ID, mockFs)
    );
    const content = await fsImpl.read(SANDBOX_ID, "/app/index.ts");
    expect(content).toBe("file contents");
    expect(mockFs.read).toHaveBeenCalledWith("/app/index.ts");
  });

  it("writes a file via the SDK", async () => {
    const mockFs = makeMockSdkFs();
    const fsImpl: SandboxFileSystem = new E2BFileSystem(
      makeSdkRegistry(SANDBOX_ID, mockFs)
    );
    await fsImpl.write(SANDBOX_ID, "/app/index.ts", "export {};");
    expect(mockFs.write).toHaveBeenCalledWith("/app/index.ts", "export {};");
  });

  it("lists directory entries", async () => {
    const mockFs = makeMockSdkFs();
    const fsImpl: SandboxFileSystem = new E2BFileSystem(
      makeSdkRegistry(SANDBOX_ID, mockFs)
    );
    const entries = await fsImpl.list(SANDBOX_ID, "/app");
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("index.ts");
    expect(entries[1].type).toBe("dir");
  });

  it("throws SandboxNotFoundError for an unknown sandbox id", async () => {
    const fsImpl: SandboxFileSystem = new E2BFileSystem(new Map());
    await expect(
      fsImpl.read(SandboxIdSchema.parse("sbx_unknown"), "/any")
    ).rejects.toThrow("SandboxNotFoundError");
  });
});
