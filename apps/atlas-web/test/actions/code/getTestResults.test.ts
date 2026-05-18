import { describe, it, expect, vi, beforeEach } from "vitest";

// Auth — assume signed-in unless overridden.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
}));

// Stub the sandbox factory so we never hit the real E2B lifecycle / spend pool.
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: vi.fn().mockResolvedValue({
      record: { sandboxId: "sb_test", templateId: "atlas-next-ts" },
      previewUrl: "https://3000-sb_test.e2b.app",
    }),
  }),
}));

// commands.run mock — each test installs its own queued responses.
const runMock = vi.fn();
vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    connect: vi.fn(async () => ({
      commands: { run: runMock },
    })),
  },
}));

import { getTestResults } from "../../../lib/actions/code/getTestResults";

beforeEach(() => {
  runMock.mockReset();
});

describe("getTestResults Server Action", () => {
  it("parses Vitest --reporter=json output into VitestSuiteResult[]", async () => {
    const vitestJson = JSON.stringify({
      testResults: [
        {
          name: "/app/src/foo.test.ts",
          startTime: 1000,
          endTime: 1250,
          assertionResults: [
            { title: "passes A", status: "passed", duration: 10 },
            { title: "passes B", status: "passed", duration: 20 },
            { title: "skipped C", status: "skipped" },
          ],
        },
        {
          name: "/app/src/bar.test.ts",
          startTime: 2000,
          endTime: 2400,
          assertionResults: [
            { title: "fails D", status: "failed", duration: 50 },
            { title: "passes E", status: "passed", duration: 5 },
          ],
        },
      ],
    });
    runMock.mockResolvedValueOnce({ stdout: vitestJson, stderr: "", exitCode: 1 });

    const result = await getTestResults({ projectId: "p-1" });

    expect(result.status).toBe("done");
    expect(result.suites).toHaveLength(2);
    expect(result.suites[0]).toEqual({
      name: "/app/src/foo.test.ts",
      passed: 2,
      failed: 0,
      skipped: 1,
      duration: 30,
    });
    expect(result.suites[1]).toEqual({
      name: "/app/src/bar.test.ts",
      passed: 1,
      failed: 1,
      skipped: 0,
      duration: 55,
    });
    // Verify the exact command + timeout we issued.
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      "pnpm test --reporter=json --silent 2>/dev/null",
      { timeoutMs: 5 * 60 * 1000 }
    );
  });

  it("falls back to raw output when JSON.parse fails", async () => {
    // First call: JSON-mode, returns junk that is not parseable.
    runMock.mockResolvedValueOnce({
      stdout: "this is not json — pnpm: command not found\n",
      stderr: "",
      exitCode: 1,
    });
    // Second call: plain `pnpm test` fallback.
    runMock.mockResolvedValueOnce({
      stdout: "FAIL  src/x.test.ts > something\n",
      stderr: "AssertionError: expected 1 to be 2\n",
      exitCode: 1,
    });

    const result = await getTestResults({ projectId: "p-1" });

    expect(result.status).toBe("raw");
    expect(result.suites).toEqual([]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("FAIL  src/x.test.ts");
    expect(result.output).toContain("AssertionError");
    // Two calls: JSON attempt then raw fallback.
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock.mock.calls[1]?.[0]).toBe("pnpm test");
  });

  it("returns status: timeout when commands.run rejects with a timeout error", async () => {
    runMock.mockRejectedValueOnce(new Error("command timed out after 300000ms"));
    const result = await getTestResults({ projectId: "p-1" });
    expect(result.status).toBe("timeout");
    expect(result.suites).toEqual([]);
  });

  it("throws UNAUTHORIZED when no signed-in user", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    await expect(getTestResults({ projectId: "p-1" })).rejects.toThrow("UNAUTHORIZED");
  });
});
