import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditPatchQueue } from "@/lib/canvas/use-edit-patch-queue";

describe("useEditPatchQueue", () => {
  it("submitPatch calls the supplied applier and pushes inverse onto the undo stack", async () => {
    const apply = vi.fn().mockResolvedValue({
      ok: true,
      inverse: { kind: "text-replace", atlasId: "h", oldText: "Hi", newText: "Hello" }
    });
    const { result } = renderHook(() => useEditPatchQueue({ apply }));

    await act(async () => {
      await result.current.submitPatch({
        filePath: "/code/src/app/page.tsx",
        patch: { kind: "text-replace", atlasId: "h", oldText: "Hello", newText: "Hi" }
      });
    });

    expect(apply).toHaveBeenCalledOnce();
    expect(result.current.canUndo).toBe(true);
  });

  it("undo() applies the inverse of the most recent successful patch", async () => {
    const apply = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        inverse: { kind: "text-replace", atlasId: "h", oldText: "Hi", newText: "Hello" }
      })
      .mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useEditPatchQueue({ apply }));
    await act(async () => {
      await result.current.submitPatch({
        filePath: "/code/src/app/page.tsx",
        patch: { kind: "text-replace", atlasId: "h", oldText: "Hello", newText: "Hi" }
      });
    });
    await act(async () => { await result.current.undo(); });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0]).toMatchObject({
      patch: { kind: "text-replace", oldText: "Hi", newText: "Hello" }
    });
  });
});
