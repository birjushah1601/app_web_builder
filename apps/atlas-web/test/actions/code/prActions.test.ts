import { describe, it, expect, vi, beforeEach } from "vitest";

// E.4: openPr now provisions a sandbox and runs `git push` before opening
// the PR. We expose the sandbox `commands.run` mock on globalThis so it is
// reachable from inside the hoisted vi.mock factory below — `vi.mock` is
// hoisted to the top of the file, so closing over a normal `const` declared
// here would be a temporal-dead-zone error.
//
// (vitest also offers `vi.hoisted()` for this; globalThis is simpler and
// keeps the mock-state plumbing in one place.)
declare global {

  var __sandboxRunMock: ReturnType<typeof vi.fn>;
}
globalThis.__sandboxRunMock = vi.fn();

// Mock Octokit factory before importing actions
vi.mock("../../../lib/code/octokitClient", () => ({
  createOctokit: vi.fn(),
  // listPrs uses tryCreateOctokit (graceful-degrade variant); mock it too.
  tryCreateOctokit: vi.fn(),
  parseRepoSlug: vi.fn().mockReturnValue({ owner: "acme", repo: "my-app" }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
}));

vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: vi.fn().mockResolvedValue({
      record: { sandboxId: "sb_test_123", projectId: "p-1" },
      previewUrl: "https://3000-sb_test_123.e2b.app",
    }),
  }),
}));

vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    connect: vi.fn().mockResolvedValue({
      commands: {
        run: (...args: unknown[]) => globalThis.__sandboxRunMock(...args),
      },
    }),
  },
}));

import { createOctokit, tryCreateOctokit, parseRepoSlug } from "../../../lib/code/octokitClient";
import { listPrs } from "../../../lib/actions/code/listPrs";
import { openPr } from "../../../lib/actions/code/openPr";
import { getPrDiff } from "../../../lib/actions/code/getPrDiff";
import { postPrComment } from "../../../lib/actions/code/postPrComment";
import { mergePr } from "../../../lib/actions/code/mergePr";

const mockCreateOctokit = vi.mocked(createOctokit);
const mockTryCreateOctokit = vi.mocked(tryCreateOctokit);
const mockSandboxRun = globalThis.__sandboxRunMock;

function makeMockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    pulls: {
      list: vi.fn().mockResolvedValue({
        data: [
          { number: 42, title: "Add feature", state: "open", html_url: "https://github.com/acme/my-app/pull/42", head: { ref: "feat/x" }, base: { ref: "main" } },
        ],
      }),
      create: vi.fn().mockResolvedValue({
        data: { number: 43, html_url: "https://github.com/acme/my-app/pull/43" },
      }),
      merge: vi.fn().mockResolvedValue({
        data: { sha: "abc1234", merged: true },
      }),
      get: vi.fn().mockResolvedValue({ data: { number: 42 } }),
    },
    issues: {
      createComment: vi.fn().mockResolvedValue({ data: { id: 99 } }),
    },
    request: vi.fn().mockResolvedValue({ data: "diff --git a/..." }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a successful sandbox push. Per-test overrides simulate failure.
  mockSandboxRun.mockResolvedValue({
    stdout: "Branch pushed.",
    stderr: "",
    exitCode: 0,
  });
});

const CTX = { projectId: "p-1", repoSlug: "acme/my-app" };

describe("listPrs", () => {
  it("returns a list of open PRs", async () => {
    mockTryCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const prs = await listPrs({ ...CTX, state: "open" });
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(42);
    expect(prs[0].title).toBe("Add feature");
  });
});

describe("openPr", () => {
  it("pushes the head branch via the sandbox before calling the GitHub API", async () => {
    const octokitMock = makeMockOctokit();
    mockCreateOctokit.mockReturnValueOnce(octokitMock as never);
    process.env.GITHUB_TOKEN = "ghp_test_token";

    const result = await openPr({
      ...CTX,
      head: "feat/x",
      base: "main",
      title: "Add feature",
      body: "Description",
    });

    // The action ran the expected push command, with a 30s timeout cap, and
    // forwarded GITHUB_TOKEN into the sandbox env.
    expect(mockSandboxRun).toHaveBeenCalledTimes(1);
    const [cmd, opts] = mockSandboxRun.mock.calls[0];
    expect(cmd).toBe("cd /code && git push -u origin feat/x");
    expect(opts.timeoutMs).toBe(30_000);
    expect(opts.envs).toEqual({ GITHUB_TOKEN: "ghp_test_token" });

    // Octokit was called only after the successful push.
    expect(octokitMock.pulls.create).toHaveBeenCalledTimes(1);
    expect("prUrl" in result && result.prUrl).toBe("https://github.com/acme/my-app/pull/43");
    expect("prNumber" in result && result.prNumber).toBe(43);
  });

  it("returns push_failed and skips the GitHub API when the sandbox push fails", async () => {
    const octokitMock = makeMockOctokit();
    mockCreateOctokit.mockReturnValueOnce(octokitMock as never);
    mockSandboxRun.mockResolvedValueOnce({
      stdout: "",
      stderr: "remote: Permission denied\nfatal: unable to access",
      exitCode: 128,
    });

    const result = await openPr({
      ...CTX,
      head: "feat/x",
      base: "main",
      title: "Add feature",
    });

    expect(result).toEqual({
      status: "push_failed",
      stdout: "",
      stderr: "remote: Permission denied\nfatal: unable to access",
      exitCode: 128,
    });
    // Crucially: pulls.create MUST NOT be called when the push fails.
    expect(octokitMock.pulls.create).not.toHaveBeenCalled();
  });
});

describe("getPrDiff", () => {
  it("returns a diff string", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const result = await getPrDiff({ ...CTX, prNumber: 42 });
    expect(typeof result.diff).toBe("string");
  });
});

describe("postPrComment", () => {
  it("posts a comment and returns its id", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const result = await postPrComment({ ...CTX, prNumber: 42, body: "LGTM" });
    expect(result.commentId).toBe(99);
  });
});

describe("mergePr", () => {
  it("merges a PR and returns the merge SHA", async () => {
    mockCreateOctokit.mockReturnValueOnce(makeMockOctokit() as never);
    const result = await mergePr({ ...CTX, prNumber: 42, mergeMethod: "squash" });
    expect(result.sha).toBe("abc1234");
    expect(result.merged).toBe(true);
  });
});
