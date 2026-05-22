import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("selectSchemaDirection action", () => {
  it("forwards directionId to the registry's resolveOption", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectSchemaDirection } = await import("@/lib/actions/selectSchemaDirection");
    await selectSchemaDirection({
      ritualId: "r-1",
      directionId: "schema-dir-rest"
    });

    expect(resolveOption).toHaveBeenCalledTimes(1);
    expect(resolveOption).toHaveBeenCalledWith("r-1", {
      directionId: "schema-dir-rest"
    });
  });

  it("works for REST contract style direction ids", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectSchemaDirection } = await import("@/lib/actions/selectSchemaDirection");
    await selectSchemaDirection({ ritualId: "r-2", directionId: "schema-dir-rest-v2" });

    expect(resolveOption).toHaveBeenCalledWith("r-2", {
      directionId: "schema-dir-rest-v2"
    });
  });

  it("works for GraphQL contract style direction ids", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectSchemaDirection } = await import("@/lib/actions/selectSchemaDirection");
    await selectSchemaDirection({ ritualId: "r-3", directionId: "schema-dir-graphql" });

    expect(resolveOption).toHaveBeenCalledWith("r-3", {
      directionId: "schema-dir-graphql"
    });
  });

  it("throws unauthorized when no user is signed in", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));

    const { selectSchemaDirection } = await import("@/lib/actions/selectSchemaDirection");
    await expect(
      selectSchemaDirection({ ritualId: "r-1", directionId: "schema-dir-rest" })
    ).rejects.toThrow("unauthorized");
    expect(resolveOption).not.toHaveBeenCalled();
  });

  it("validates required inputs", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectSchemaDirection } = await import("@/lib/actions/selectSchemaDirection");
    await expect(
      selectSchemaDirection({ ritualId: "", directionId: "schema-dir-x" })
    ).rejects.toThrow("ritualId is required");
    await expect(
      selectSchemaDirection({ ritualId: "r-1", directionId: "" })
    ).rejects.toThrow("directionId is required");
    expect(resolveOption).not.toHaveBeenCalled();
  });

  it("is idempotent — second call for same ritualId reaches the registry (no-op handled inside)", async () => {
    const resolveOption = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveOption })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { selectSchemaDirection } = await import("@/lib/actions/selectSchemaDirection");
    await selectSchemaDirection({ ritualId: "r-1", directionId: "schema-dir-rest" });
    await selectSchemaDirection({ ritualId: "r-1", directionId: "schema-dir-rest" });

    expect(resolveOption).toHaveBeenCalledTimes(2);
  });
});
