import { describe, it, expect, vi } from "vitest";
import { performShipAction } from "@/lib/deploy/ship-action";

describe("performShipAction", () => {
  it("calls DeployOrchestrator.deploy with derived request, returns publicUrl", async () => {
    const deploy = vi.fn().mockResolvedValue({
      deployId: "x",
      request: {} as never,
      phase: "healthy",
      publicUrl: "https://abc.atlas.app",
      argoApplicationName: "p-abc-main",
      branchSchemaName: "br_x",
      startedAt: "t0",
      endedAt: "t1"
    });
    const orch = { deploy } as never;

    const result = await performShipAction({
      orchestrator: orch,
      projectId: "11111111-1111-4111-8111-111111111111",
      subdomain: "abc",
      apex: "atlas.app",
      branchId: "main",
      imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
      target: "production"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.publicUrl).toBe("https://abc.atlas.app");
    }
    expect(deploy).toHaveBeenCalledTimes(1);
  });

  it("returns a structured failure when orchestrator throws", async () => {
    const orch = { deploy: vi.fn().mockRejectedValue(new Error("boom")) } as never;
    const result = await performShipAction({
      orchestrator: orch,
      projectId: "11111111-1111-4111-8111-111111111111",
      subdomain: "abc",
      apex: "atlas.app",
      branchId: "main",
      imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
      target: "production"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("boom");
  });
});
