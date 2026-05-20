import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2BLifecycle } from "../src/lifecycle.js";
import { E2BFileSystem } from "../src/filesystem.js";
import { E2BExec } from "../src/exec.js";
import { E2BPreview } from "../src/preview.js";
import { SandboxIdSchema } from "../src/types.js";

vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    create: vi.fn(),
  },
}));

import { Sandbox as MockSandbox } from "@e2b/sdk";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

describe("sandbox-e2b integration — lifecycle → filesystem → exec → preview", () => {
  let fakeSandbox: Record<string, unknown>;
  let lifecycle: E2BLifecycle;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSandbox = {
      sandboxId: "sbx_integration_001",
      kill: vi.fn().mockResolvedValue(undefined),
      files: {
        read: vi.fn().mockResolvedValue("// app entry"),
        write: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ name: "app.ts", type: "file", path: "/app/app.ts" }]),
      },
      commands: {
        run: vi.fn().mockResolvedValue({
          exitCode: 0,
          output: { stdout: "Test passed\n", stderr: "" },
        }),
        streamRun: async function* () {
          yield { stream: "stdout" as const, data: "watching...\n" };
        },
      },
      getHost: (port: number) => `${port}-sbx_integration_001.e2b.app`,
    };
    (MockSandbox.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSandbox);

    lifecycle = new E2BLifecycle({
      apiKey: "test-key",
      templateDigests: { "atlas-next-ts": "sha256abc", "atlas-python-fastapi": "sha256def" },
    });
  });

  it("full flow: provision → write → run → preview URL", async () => {
    // 1. Provision
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    expect(record.status).toBe("running");

    const sandboxId = SandboxIdSchema.parse(record.sandboxId);

    // 2. Write a file via the shared registry
    // We construct a registry from the fake SDK object (simulating what the web factory does)
    const sdkRegistry = new Map([[sandboxId as string, { files: fakeSandbox.files as never }]]);
    const fs = new E2BFileSystem(sdkRegistry);
    await fs.write(sandboxId, "/app/app.ts", "export default function App() {}");
    expect((fakeSandbox.files as Record<string, ReturnType<typeof vi.fn>>).write).toHaveBeenCalledWith(
      "/app/app.ts",
      "export default function App() {}"
    );

    // 3. Run a command
    const execRegistry = new Map([[sandboxId as string, { commands: fakeSandbox.commands as never }]]);
    const exec = new E2BExec(execRegistry);
    const result = await exec.runCommand(sandboxId, "npx vitest run --reporter=json");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Test passed");

    // 4. Get preview URL
    const previewRegistry = new Map([[
      sandboxId as string,
      { getHost: (port: number) => `${port}-${sandboxId}.e2b.app` },
    ]]);
    const preview = new E2BPreview(previewRegistry);
    const url = preview.getPreviewUrl(sandboxId, 3000);
    expect(url).toMatch(/^https:\/\/3000-/);
  });

  it("terminates the sandbox cleanly", async () => {
    const record = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    const sandboxId = SandboxIdSchema.parse(record.sandboxId);
    await lifecycle.terminate(sandboxId);
    expect(fakeSandbox.kill).toHaveBeenCalledOnce();
  });
});
