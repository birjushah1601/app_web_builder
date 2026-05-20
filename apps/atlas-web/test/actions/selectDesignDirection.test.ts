import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("selectDesignDirection action", () => {
  it("forwards directionId + tokens to the registry's resolveOption", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectDesignDirection } = await import("@/lib/actions/selectDesignDirection");
    await selectDesignDirection({
      ritualId: "r-1",
      directionId: "dir-bold",
      tokens: { palette: { primary: "#000" } }
    });

    expect(resolveOption).toHaveBeenCalledTimes(1);
    expect(resolveOption).toHaveBeenCalledWith("r-1", {
      directionId: "dir-bold",
      tokens: { palette: { primary: "#000" } }
    });
  });

  it("passes tokens=undefined when caller omits them", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectDesignDirection } = await import("@/lib/actions/selectDesignDirection");
    await selectDesignDirection({ ritualId: "r-1", directionId: "dir-bold" });

    expect(resolveOption).toHaveBeenCalledWith("r-1", {
      directionId: "dir-bold",
      tokens: undefined
    });
  });

  it("throws unauthorized when no user is signed in", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));

    const { selectDesignDirection } = await import("@/lib/actions/selectDesignDirection");
    await expect(
      selectDesignDirection({ ritualId: "r-1", directionId: "dir-bold" })
    ).rejects.toThrow("unauthorized");
    expect(resolveOption).not.toHaveBeenCalled();
  });

  it("validates required inputs", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectDesignDirection } = await import("@/lib/actions/selectDesignDirection");
    await expect(
      selectDesignDirection({ ritualId: "", directionId: "dir-x" })
    ).rejects.toThrow("ritualId is required");
    await expect(
      selectDesignDirection({ ritualId: "r-1", directionId: "" })
    ).rejects.toThrow("directionId is required");
    expect(resolveOption).not.toHaveBeenCalled();
  });
});
