import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan F.5 follow-up — unit tests for nodeGitClient (spawn-based default
 * GitClient in gitops-repo.ts).
 *
 * F.5 covered pushArgoApplicationToRepo by injecting a fake GitClient; the
 * default `nodeGitClient` that shells out to `git` via child_process.spawn
 * was untested. These tests close that gap by mocking child_process.spawn
 * and asserting:
 *
 *   • the exact argv passed to git for each method
 *   • cwd propagation (clone has no cwd; everything else uses the repo dir)
 *   • exit-code error surfacing (assertOk includes cmd name + stderr)
 *   • the commit() branching on `git diff --cached --quiet` (idempotent
 *     short-circuit when nothing is staged)
 */

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// Import after vi.mock so the SUT picks up the mocked module.
const { nodeGitClient } = await import("../src/gitops-repo.js");

interface FakeChildOpts {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorAfterClose?: Error;
}

/**
 * Build a fake spawn child: an EventEmitter with .stdout / .stderr sub-emitters.
 * stdout/stderr "data" buffers and the "close" event are emitted on next tick
 * so the caller has time to attach listeners.
 */
function makeFakeChild(opts: FakeChildOpts = {}): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
    child.emit("close", opts.exitCode ?? 0);
  });
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
});

// ────────────────────────────────────────────────────────────────────────────
// clone
// ────────────────────────────────────────────────────────────────────────────

describe("nodeGitClient.clone", () => {
  it("passes --depth and --branch when both opts are set", async () => {
    spawnMock.mockReturnValueOnce(makeFakeChild({ exitCode: 0 }));

    await nodeGitClient.clone("https://example.com/repo.git", "/tmp/foo", {
      depth: 1,
      branch: "main"
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "--branch", "main", "https://example.com/repo.git", "/tmp/foo"],
      expect.objectContaining({ cwd: undefined, env: process.env })
    );
  });

  it("omits --depth when depth opt is absent", async () => {
    spawnMock.mockReturnValueOnce(makeFakeChild({ exitCode: 0 }));

    await nodeGitClient.clone("https://example.com/repo.git", "/tmp/foo", {
      branch: "main"
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["clone", "--branch", "main", "https://example.com/repo.git", "/tmp/foo"],
      expect.objectContaining({ cwd: undefined })
    );
  });

  it("omits --branch when branch opt is absent", async () => {
    spawnMock.mockReturnValueOnce(makeFakeChild({ exitCode: 0 }));

    await nodeGitClient.clone("https://example.com/repo.git", "/tmp/foo", { depth: 1 });

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "https://example.com/repo.git", "/tmp/foo"],
      expect.objectContaining({ cwd: undefined })
    );
  });

  it("omits both flags when opts is undefined", async () => {
    spawnMock.mockReturnValueOnce(makeFakeChild({ exitCode: 0 }));

    await nodeGitClient.clone("https://example.com/repo.git", "/tmp/foo");

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["clone", "https://example.com/repo.git", "/tmp/foo"],
      expect.objectContaining({ cwd: undefined })
    );
  });

  it("throws with cmd name + stderr when exit code is non-zero", async () => {
    spawnMock.mockReturnValueOnce(
      makeFakeChild({ exitCode: 128, stderr: "fatal: repository not found" })
    );

    await expect(
      nodeGitClient.clone("https://example.com/missing.git", "/tmp/foo", { depth: 1 })
    ).rejects.toThrow(/clone https:\/\/example\.com\/missing\.git/);

    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(
      makeFakeChild({ exitCode: 128, stderr: "fatal: repository not found" })
    );

    await expect(
      nodeGitClient.clone("https://example.com/missing.git", "/tmp/foo", { depth: 1 })
    ).rejects.toThrow(/fatal: repository not found/);
  });

  it("includes stdout in error when stderr is empty (assertOk fallback)", async () => {
    spawnMock.mockReturnValueOnce(
      makeFakeChild({ exitCode: 1, stdout: "some stdout diagnostic" })
    );

    await expect(
      nodeGitClient.clone("https://example.com/repo.git", "/tmp/foo")
    ).rejects.toThrow(/some stdout diagnostic/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// add
// ────────────────────────────────────────────────────────────────────────────

describe("nodeGitClient.add", () => {
  it("calls git add -- <pathRel> in the repo dir", async () => {
    spawnMock.mockReturnValueOnce(makeFakeChild({ exitCode: 0 }));

    await nodeGitClient.add("/tmp/foo", "applications/proj.yaml");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["add", "--", "applications/proj.yaml"],
      expect.objectContaining({ cwd: "/tmp/foo", env: process.env })
    );
  });

  it("throws with cmd name + stderr on non-zero exit", async () => {
    spawnMock.mockReturnValueOnce(
      makeFakeChild({ exitCode: 1, stderr: "pathspec did not match" })
    );

    await expect(nodeGitClient.add("/tmp/foo", "missing.yaml")).rejects.toThrow(
      /add missing\.yaml.*pathspec did not match/s
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// commit — two-branch coverage
// ────────────────────────────────────────────────────────────────────────────

describe("nodeGitClient.commit", () => {
  it("short-circuits when there are no staged changes (diff --cached --quiet exits 0)", async () => {
    // 1st spawn: git diff --cached --quiet → exit 0 (no changes)
    // 2nd spawn: git rev-parse HEAD → stdout = sha
    spawnMock
      .mockReturnValueOnce(makeFakeChild({ exitCode: 0 }))
      .mockReturnValueOnce(makeFakeChild({ exitCode: 0, stdout: "abc123\n" }));

    const result = await nodeGitClient.commit("/tmp/foo", "deploy: dep-1");

    expect(result).toEqual({ sha: "abc123", committed: false });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["diff", "--cached", "--quiet"],
      expect.objectContaining({ cwd: "/tmp/foo" })
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["rev-parse", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/foo" })
    );
    // No `git commit` call must have happened
    const commitCalls = spawnMock.mock.calls.filter(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "commit"
    );
    expect(commitCalls).toHaveLength(0);
  });

  it("commits when staged changes are present (diff --cached --quiet exits 1)", async () => {
    // 1st spawn: diff --cached --quiet → exit 1 (changes present)
    // 2nd spawn: git commit -m <message> → exit 0
    // 3rd spawn: git rev-parse HEAD → sha
    spawnMock
      .mockReturnValueOnce(makeFakeChild({ exitCode: 1 }))
      .mockReturnValueOnce(makeFakeChild({ exitCode: 0 }))
      .mockReturnValueOnce(makeFakeChild({ exitCode: 0, stdout: "newsha456\n" }));

    const result = await nodeGitClient.commit("/tmp/foo", "deploy: dep-2");

    expect(result).toEqual({ sha: "newsha456", committed: true });
    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["diff", "--cached", "--quiet"],
      expect.objectContaining({ cwd: "/tmp/foo" })
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["commit", "-m", "deploy: dep-2"],
      expect.objectContaining({ cwd: "/tmp/foo" })
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "git",
      ["rev-parse", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/foo" })
    );
  });

  it("throws when git commit itself fails", async () => {
    spawnMock
      .mockReturnValueOnce(makeFakeChild({ exitCode: 1 })) // diff → changes present
      .mockReturnValueOnce(
        makeFakeChild({ exitCode: 1, stderr: "no user.email configured" })
      ); // commit fails

    await expect(nodeGitClient.commit("/tmp/foo", "deploy: dep-3")).rejects.toThrow(
      /git commit failed.*no user\.email configured/s
    );
  });

  it("throws when rev-parse HEAD fails after a successful commit", async () => {
    spawnMock
      .mockReturnValueOnce(makeFakeChild({ exitCode: 1 })) // diff
      .mockReturnValueOnce(makeFakeChild({ exitCode: 0 })) // commit
      .mockReturnValueOnce(
        makeFakeChild({ exitCode: 128, stderr: "fatal: bad revision" })
      );

    await expect(nodeGitClient.commit("/tmp/foo", "deploy: dep-4")).rejects.toThrow(
      /rev-parse HEAD.*fatal: bad revision/s
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// push
// ────────────────────────────────────────────────────────────────────────────

describe("nodeGitClient.push", () => {
  it("calls git push origin without a branch arg when opts.branch is absent", async () => {
    spawnMock.mockReturnValueOnce(makeFakeChild({ exitCode: 0 }));

    await nodeGitClient.push("/tmp/foo");

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["push", "origin"],
      expect.objectContaining({ cwd: "/tmp/foo", env: process.env })
    );
  });

  it("appends branch name when opts.branch is set", async () => {
    spawnMock.mockReturnValueOnce(makeFakeChild({ exitCode: 0 }));

    await nodeGitClient.push("/tmp/foo", { branch: "main" });

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "main"],
      expect.objectContaining({ cwd: "/tmp/foo" })
    );
  });

  it("throws with cmd name + stderr on push failure", async () => {
    spawnMock.mockReturnValueOnce(
      makeFakeChild({ exitCode: 1, stderr: "rejected: non-fast-forward" })
    );

    await expect(nodeGitClient.push("/tmp/foo", { branch: "main" })).rejects.toThrow(
      /git push failed.*non-fast-forward/s
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// headSha
// ────────────────────────────────────────────────────────────────────────────

describe("nodeGitClient.headSha", () => {
  it("returns trimmed stdout of `git rev-parse HEAD`", async () => {
    spawnMock.mockReturnValueOnce(
      makeFakeChild({ exitCode: 0, stdout: "deadbeefcafe\n" })
    );

    const sha = await nodeGitClient.headSha("/tmp/foo");

    expect(sha).toBe("deadbeefcafe");
    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/foo" })
    );
  });

  it("throws with cmd name + stderr on rev-parse failure", async () => {
    spawnMock.mockReturnValueOnce(
      makeFakeChild({ exitCode: 128, stderr: "fatal: not a git repository" })
    );

    await expect(nodeGitClient.headSha("/tmp/foo")).rejects.toThrow(
      /rev-parse HEAD.*not a git repository/s
    );
  });
});
