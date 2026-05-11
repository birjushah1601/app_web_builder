import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2BLifecycle } from "../src/lifecycle.js";
import type { SandboxLifecycle } from "../src/lifecycle.js";
import { SandboxIdSchema } from "../src/types.js";

// Mock the entire @e2b/sdk module
vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

import { Sandbox as MockSandbox } from "@e2b/sdk";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("E2BLifecycle", () => {
  let lifecycle: SandboxLifecycle;
  let fakeSandbox: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSandbox = {
      sandboxId: "sbx_abc123",
      kill: vi.fn().mockResolvedValue(undefined),
    };
    (MockSandbox.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSandbox);

    lifecycle = new E2BLifecycle({
      apiKey: "test-api-key",
      templateDigests: {
        "atlas-next-ts": "sha256abc",
        "atlas-python-fastapi": "sha256def",
      },
    });
  });

  it("provisions a sandbox and returns a SandboxRecord", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    expect(record.templateId).toBe("atlas-next-ts");
    expect(record.projectId).toBe(PROJECT_ID);
    expect(record.status).toBe("running");
    expect(SandboxIdSchema.safeParse(record.sandboxId).success).toBe(true);
    expect(MockSandbox.create).toHaveBeenCalledWith("atlas-next-ts", {
      apiKey: "test-api-key",
      metadata: { projectId: PROJECT_ID, digest: "sha256abc" },
    });
  });

  it("terminates a running sandbox", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    await lifecycle.terminate(record.sandboxId);
    expect(fakeSandbox.kill).toHaveBeenCalledOnce();
  });

  it("restarts a sandbox by terminating then re-provisioning", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    const restarted = await lifecycle.restart(record.sandboxId);
    expect(restarted.status).toBe("running");
    expect(MockSandbox.create).toHaveBeenCalledTimes(2);
  });

  it("throws SandboxNotFoundError when terminating an unknown id", async () => {
    await expect(
      lifecycle.terminate("sbx_unknown" as ReturnType<typeof SandboxIdSchema.parse>)
    ).rejects.toThrow("SandboxNotFoundError");
  });
});
