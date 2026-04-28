import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxFactory } from "../lib/sandbox/factory";
import type { SandboxLifecycle } from "@atlas/sandbox-e2b";
import type { SpendReader } from "@atlas/sandbox-e2b";

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function makeLifecycleMock(): SandboxLifecycle {
  let callCount = 0;
  return {
    provision: vi.fn().mockImplementation(async (templateId: string, projectId: string) => ({
      sandboxId: `sbx_factory_${++callCount}`,
      templateId,
      projectId,
      provisionedAt: new Date().toISOString(),
      status: "running" as const,
    })),
    terminate: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn(),
  };
}

function makeSpendReaderMock(): SpendReader {
  return {
    getAccumulatedSpend: vi.fn().mockResolvedValue(0),
    getRollingAverageSpend: vi.fn().mockResolvedValue(0),
  };
}

describe("SandboxFactory", () => {
  let lifecycle: SandboxLifecycle;
  let factory: SandboxFactory;

  beforeEach(() => {
    lifecycle = makeLifecycleMock();
    factory = new SandboxFactory({
      lifecycle,
      spendReader: makeSpendReaderMock(),
      spendCapConfig: { capUsd: 50, warnMultiplier: 3 },
      defaultTemplate: "atlas-next-ts",
    });
  });

  it("provisions a sandbox on first getOrProvision call", async () => {
    const session = await factory.getOrProvision(PROJECT_ID);
    expect(session.record.status).toBe("running");
    expect(lifecycle.provision).toHaveBeenCalledOnce();
  });

  it("returns the cached session on subsequent calls — no double-provision", async () => {
    const s1 = await factory.getOrProvision(PROJECT_ID);
    const s2 = await factory.getOrProvision(PROJECT_ID);
    expect(s1.record.sandboxId).toBe(s2.record.sandboxId);
    expect(lifecycle.provision).toHaveBeenCalledOnce();
  });

  it("provisions separate sandboxes for different projects", async () => {
    const OTHER_PROJECT = "55555555-5555-4555-8555-555555555555";
    const s1 = await factory.getOrProvision(PROJECT_ID);
    const s2 = await factory.getOrProvision(OTHER_PROJECT);
    expect(s1.record.sandboxId).not.toBe(s2.record.sandboxId);
    expect(lifecycle.provision).toHaveBeenCalledTimes(2);
  });

  it("terminates and evicts the session from cache", async () => {
    await factory.getOrProvision(PROJECT_ID);
    await factory.terminate(PROJECT_ID);
    expect(lifecycle.terminate).toHaveBeenCalledOnce();
    // After terminate, next getOrProvision should re-provision
    await factory.getOrProvision(PROJECT_ID);
    expect(lifecycle.provision).toHaveBeenCalledTimes(2);
  });
});
