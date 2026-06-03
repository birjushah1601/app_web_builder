// Real-git integration for nodeGitClient — boots a bare repo locally and
// exercises clone → add → commit → push → idempotent-recommit against the
// real `git` binary. Complements node-git-client.test.ts (which mocks
// child_process.spawn) by covering actual command semantics: does the real
// `git` accept the args we generate, does the commit reach the bare remote,
// does the no-changes short-circuit correctly read `diff --cached --quiet`'s
// exit code in practice.
//
// Skips when `git` is not on PATH (rare in dev, more common in some CI
// minimal images). The skip is detected synchronously at module load via
// execSync so the describe.skipIf check is evaluated up-front.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeGitClient } from "../src/gitops-repo.js";

function gitExec(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => { stdout += b.toString(); });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    child.on("error", reject);
  });
}

let gitOk = false;
try {
  execSync("git --version", { stdio: "ignore" });
  gitOk = true;
} catch {
  gitOk = false;
}

(gitOk ? describe : describe.skip)("nodeGitClient — real git binary integration", () => {
  let rootTmp: string;
  let remotePath: string;
  let clonePath: string;

  beforeAll(() => {
    // No-op; we rely on the synchronous gitOk check above.
  });

  beforeEach(async () => {
    rootTmp = await mkdtemp(join(tmpdir(), "atlas-git-it-"));
    remotePath = join(rootTmp, "remote.git");
    clonePath = join(rootTmp, "clone");

    // Bare remote on `main`. --initial-branch requires git >= 2.28; if older
    // git is installed the test will fail with a clear error and we'd update
    // the gitOk check to require a minimum version.
    const init = await gitExec(["init", "--bare", "--initial-branch=main", remotePath]);
    if (init.exitCode !== 0) {
      throw new Error(`git init --bare failed: ${init.stderr || init.stdout}`);
    }

    // Seed the bare remote with one commit so a depth=1 clone of `main` works.
    // We do this via a throwaway non-bare clone, NOT via nodeGitClient (this is
    // setup; nodeGitClient is under test downstream).
    const seedDir = join(rootTmp, "seed");
    await mkdir(seedDir);
    const seedSteps = [
      ["init", "--initial-branch=main", "."],
      ["config", "user.email", "atlas-test@example.invalid"],
      ["config", "user.name", "Atlas Test"],
      // Disable commit signing in this seed repo — some dev machines have
      // commit.gpgsign=true globally, which would block the seed commit.
      ["config", "commit.gpgsign", "false"]
    ];
    for (const args of seedSteps) {
      const r = await gitExec(args, seedDir);
      if (r.exitCode !== 0) throw new Error(`seed ${args[0]} failed: ${r.stderr}`);
    }
    await writeFile(join(seedDir, "README.md"), "seed\n");
    for (const args of [["add", "README.md"], ["commit", "-m", "seed"], ["remote", "add", "origin", remotePath], ["push", "origin", "main"]]) {
      const r = await gitExec(args, seedDir);
      if (r.exitCode !== 0) throw new Error(`seed ${args[0]} failed: ${r.stderr}`);
    }
  });

  afterEach(async () => {
    await rm(rootTmp, { recursive: true, force: true }).catch(() => {});
  });

  it("end-to-end: clone → write → add → commit → push → second-pass commit is a no-op (committed=false)", async () => {
    // --- nodeGitClient.clone against the real bare remote ---
    await nodeGitClient.clone(remotePath, clonePath, { depth: 1, branch: "main" });

    // Configure user identity on the clone (commit requires this; some dev
    // machines have global config but CI minimal images may not).
    for (const args of [
      ["config", "user.email", "atlas-test@example.invalid"],
      ["config", "user.name", "Atlas Test"],
      ["config", "commit.gpgsign", "false"]
    ]) {
      const r = await gitExec(args, clonePath);
      if (r.exitCode !== 0) throw new Error(`clone config ${args[1]} failed: ${r.stderr}`);
    }

    // --- First commit cycle: write, add, commit, push ---
    const appPath = "atlas/app.yaml";
    await mkdir(join(clonePath, "atlas"), { recursive: true });
    await writeFile(join(clonePath, appPath), "kind: Application\nname: atlas-test\n");

    await nodeGitClient.add(clonePath, appPath);

    const commit1 = await nodeGitClient.commit(clonePath, "deploy: integration-test-1");
    expect(commit1.committed).toBe(true);
    expect(commit1.sha).toMatch(/^[a-f0-9]{40}$/);

    await nodeGitClient.push(clonePath, { branch: "main" });

    // Verify the bare remote received the commit by reading its log directly.
    const remoteLog = await gitExec(["log", "--oneline", "main"], remotePath);
    expect(remoteLog.exitCode).toBe(0);
    expect(remoteLog.stdout).toContain("deploy: integration-test-1");
    expect(remoteLog.stdout).toContain("seed");

    // --- headSha returns the commit we just made ---
    const head = await nodeGitClient.headSha(clonePath);
    expect(head).toBe(commit1.sha);

    // --- Second-pass commit with no staged changes: short-circuits, committed=false ---
    // The gitops-repo flow always calls add() + commit() unconditionally on
    // re-deploy. If the yaml is identical, `git diff --cached --quiet` exits 0
    // and nodeGitClient.commit must NOT create a new commit.
    await nodeGitClient.add(clonePath, appPath);
    const commit2 = await nodeGitClient.commit(clonePath, "deploy: integration-test-2-should-not-commit");
    expect(commit2.committed).toBe(false);
    expect(commit2.sha).toBe(head); // unchanged

    // --- Third-pass: actual content change → committed=true again ---
    await writeFile(join(clonePath, appPath), "kind: Application\nname: atlas-test\n# changed\n");
    await nodeGitClient.add(clonePath, appPath);
    const commit3 = await nodeGitClient.commit(clonePath, "deploy: integration-test-3");
    expect(commit3.committed).toBe(true);
    expect(commit3.sha).not.toBe(head);

    await nodeGitClient.push(clonePath, { branch: "main" });
    const remoteLog2 = await gitExec(["log", "--oneline", "main"], remotePath);
    expect(remoteLog2.stdout).toContain("integration-test-3");
    // Crucially: the no-op `integration-test-2-should-not-commit` must NOT
    // appear in the remote log — proving the short-circuit suppressed it.
    expect(remoteLog2.stdout).not.toContain("integration-test-2-should-not-commit");
  });
});
