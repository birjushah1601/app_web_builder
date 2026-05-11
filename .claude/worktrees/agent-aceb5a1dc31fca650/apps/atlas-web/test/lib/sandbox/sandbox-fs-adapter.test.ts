import { describe, it, expect, vi } from "vitest";
import { createSandboxFsAdapter } from "@/lib/sandbox/sandbox-fs-adapter";

describe("createSandboxFsAdapter", () => {
  it("read calls the underlying Sandbox.files.read with the absolute path", async () => {
    const read = vi.fn(async () => "hello");
    const session = { files: { read, write: vi.fn(), exists: vi.fn(), remove: vi.fn() } };
    const adapter = createSandboxFsAdapter(session as never);
    const out = await adapter.read("/code/x.ts");
    expect(read).toHaveBeenCalledWith("/code/x.ts");
    expect(out).toBe("hello");
  });

  it("write calls files.write with path + content", async () => {
    const write = vi.fn(async () => {});
    const session = { files: { read: vi.fn(), write, exists: vi.fn(), remove: vi.fn() } };
    const adapter = createSandboxFsAdapter(session as never);
    await adapter.write("/code/x.ts", "content");
    expect(write).toHaveBeenCalledWith("/code/x.ts", "content");
  });

  it("exists returns the underlying boolean (no translation)", async () => {
    const exists = vi.fn(async () => true);
    const session = { files: { read: vi.fn(), write: vi.fn(), exists, remove: vi.fn() } };
    const adapter = createSandboxFsAdapter(session as never);
    expect(await adapter.exists("/code/x.ts")).toBe(true);
  });

  it("remove calls files.remove and resolves regardless of return value", async () => {
    const remove = vi.fn(async () => {});
    const session = { files: { read: vi.fn(), write: vi.fn(), exists: vi.fn(), remove } };
    const adapter = createSandboxFsAdapter(session as never);
    await adapter.remove("/code/x.ts");
    expect(remove).toHaveBeenCalledWith("/code/x.ts");
  });
});
