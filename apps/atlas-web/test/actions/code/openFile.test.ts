import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @atlas/spec-graph-sync before importing the action
vi.mock("@atlas/spec-graph-sync", () => ({
  readMirroredFile: vi.fn(),
}));

// Mock Clerk auth
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
}));

import { readMirroredFile } from "@atlas/spec-graph-sync";
import { openFile } from "../../../lib/actions/code/openFile";

const mockRead = vi.mocked(readMirroredFile);

beforeEach(() => vi.clearAllMocks());

describe("openFile Server Action", () => {
  it("returns file content and language hint for a .ts file", async () => {
    mockRead.mockResolvedValueOnce("export const x = 1;");
    const result = await openFile({ projectId: "p-1", filePath: "src/index.ts" });
    expect(result.content).toBe("export const x = 1;");
    expect(result.language).toBe("typescript");
    expect(mockRead).toHaveBeenCalledWith({ projectId: "p-1", filePath: "src/index.ts" });
  });

  it("returns json language for a package.json path", async () => {
    mockRead.mockResolvedValueOnce('{"name":"my-app"}');
    const result = await openFile({ projectId: "p-1", filePath: "package.json" });
    expect(result.language).toBe("json");
  });

  it("throws NOT_FOUND when spec-graph-sync throws ENOENT", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockRead.mockRejectedValueOnce(err);
    await expect(openFile({ projectId: "p-1", filePath: "missing.ts" })).rejects.toThrow("NOT_FOUND");
  });
});
