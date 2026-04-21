import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@atlas/spec-graph-sync", () => ({
  writeMirroredFile: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
}));

import { writeMirroredFile } from "@atlas/spec-graph-sync";
import { saveFile } from "../../../lib/actions/code/saveFile.js";

const mockWrite = vi.mocked(writeMirroredFile);

beforeEach(() => vi.clearAllMocks());

describe("saveFile Server Action", () => {
  it("calls writeMirroredFile with the correct args", async () => {
    mockWrite.mockResolvedValueOnce(undefined);
    await saveFile({ projectId: "p-1", filePath: "src/foo.ts", content: "const y = 2;" });
    expect(mockWrite).toHaveBeenCalledWith({
      projectId: "p-1",
      filePath: "src/foo.ts",
      content: "const y = 2;",
    });
  });

  it("returns ok: true on success", async () => {
    mockWrite.mockResolvedValueOnce(undefined);
    const result = await saveFile({ projectId: "p-1", filePath: "src/foo.ts", content: "" });
    expect(result.ok).toBe(true);
  });

  it("throws UNAUTHORIZED when no session", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    await expect(saveFile({ projectId: "p-1", filePath: "src/x.ts", content: "" })).rejects.toThrow("UNAUTHORIZED");
  });
});
