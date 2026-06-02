import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DeployArtifact } from "@atlas/workflow-engine";

/**
 * Plan F.5 — GitOps repo push helper.
 *
 * Instead of `kubectl apply`ing the generated Argo Application directly, the
 * orchestrator can be configured to push it into a gitops repo. Argo CD then
 * reconciles from the repo — the standard GitOps flow.
 *
 * The work is:
 *   1. shallow-clone the repo into a temp dir
 *   2. write the Application yaml at the expected path
 *   3. `git add` + `git commit` (commit message includes deployId)
 *   4. `git push`
 *   5. clean up the temp dir
 *
 * The GitClient is injectable so tests can drive the helper without invoking
 * real git. The default `nodeGitClient` shells out to `git` via
 * child_process.spawn (operators must have `git` on PATH and any SSH/HTTPS
 * creds already configured at the OS level — same trust model as F.4's
 * docker shell-out).
 */

export interface GitClient {
  clone(repoUrl: string, dir: string, opts?: { branch?: string; depth?: number }): Promise<void>;
  add(dir: string, pathRel: string): Promise<void>;
  /** Returns committed=false when there were no staged changes (idempotent
   *  re-deploy short-circuit). */
  commit(dir: string, message: string): Promise<{ sha: string; committed: boolean }>;
  push(dir: string, opts?: { branch?: string }): Promise<void>;
  /** Resolve current HEAD sha. Used as the result `commitSha` when commit
   *  short-circuits with committed=false. */
  headSha(dir: string): Promise<string>;
}

export interface PushArgoApplicationOptions {
  /** Required. URL of the gitops repo to clone (HTTPS or SSH). */
  repoUrl: string;
  /** Optional. Target branch. Default = git server's default branch. */
  branch?: string;
  /** Optional. Override default git client. Default = nodeGitClient. */
  gitClient?: GitClient;
  /** Optional. Override path inside the repo at which the Application yaml
   *  is written. Default = join(argoApplication.path, argoApplication.name + ".yaml"). */
  appPath?: string;
  /** Optional. Working directory root under which the temp clone dir is
   *  created. Default = os.tmpdir(). */
  workdir?: string;
}

export interface PushArgoApplicationInput {
  deployId: string;
  deployArtifact: DeployArtifact;
}

export interface PushArgoApplicationResult {
  commitSha: string;
  repoUrl: string;
  /** Repo-relative path where the Application yaml was written. */
  path: string;
  /** true = a new commit was created. false = no changes (idempotent re-deploy). */
  committed: boolean;
}

/** Compute the default repo-relative path for the Application yaml.
 *  Joins `argoApplication.path` (without trailing slash) and `<name>.yaml`. */
function defaultAppPath(deployArtifact: DeployArtifact): string {
  const dir = (deployArtifact.argoApplication.path ?? "").replace(/\/+$/, "");
  const fileName = `${deployArtifact.argoApplication.name}.yaml`;
  return dir.length > 0 ? `${dir}/${fileName}` : fileName;
}

export async function pushArgoApplicationToRepo(
  input: PushArgoApplicationInput,
  opts: PushArgoApplicationOptions
): Promise<PushArgoApplicationResult> {
  const gitClient = opts.gitClient ?? nodeGitClient;
  const workdir = opts.workdir ?? tmpdir();
  const appPath = opts.appPath ?? defaultAppPath(input.deployArtifact);
  // Create a unique temp dir under the configured workdir so concurrent
  // pushes don't collide. The dir is removed on success (we leave it on
  // failure so operators can inspect).
  const cloneDir = await mkdtemp(join(workdir, "atlas-gitops-"));
  let success = false;
  try {
    await gitClient.clone(opts.repoUrl, cloneDir, {
      ...(opts.branch ? { branch: opts.branch } : {}),
      depth: 1
    });

    // Write the Application yaml. mkdir parents in case the path includes
    // directories that don't yet exist in the repo (Argo's "App of Apps"
    // pattern often nests applications by environment).
    const absPath = join(cloneDir, appPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, input.deployArtifact.argoApplication.content, "utf8");

    await gitClient.add(cloneDir, appPath);
    const commitMessage = `deploy: ${input.deployId}`;
    const commitResult = await gitClient.commit(cloneDir, commitMessage);

    // Push unconditionally — pushing a branch with no new commits is a
    // server-side no-op, and avoids drift if the local branch was previously
    // ahead but we just got a no-op commit this time.
    await gitClient.push(cloneDir, opts.branch ? { branch: opts.branch } : undefined);

    const commitSha = commitResult.committed
      ? commitResult.sha
      : await gitClient.headSha(cloneDir);

    success = true;
    return {
      commitSha,
      repoUrl: opts.repoUrl,
      path: appPath,
      committed: commitResult.committed
    };
  } finally {
    if (success) {
      // Best-effort cleanup; ignore failures so we don't mask a successful
      // push behind a permissions / EBUSY error on Windows.
      await rm(cloneDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Default git client — shells out to `git` via child_process.spawn.
// Same trust model as image-builder's defaultCommandRunner: operator's
// existing git credentials (SSH agent, ~/.git-credentials, etc.) carry
// through via env inheritance.
// ────────────────────────────────────────────────────────────────────────────

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runGit(args: string[], cwd?: string): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolveExec, rejectExec) => {
    const child = spawn("git", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("close", (code) => {
      resolveExec({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.on("error", (err) => {
      rejectExec(err);
    });
  });
}

function assertOk(res: SpawnResult, cmd: string): void {
  if (res.exitCode !== 0) {
    throw new Error(`git ${cmd} failed (exit ${res.exitCode}): ${res.stderr || res.stdout}`);
  }
}

export const nodeGitClient: GitClient = {
  async clone(repoUrl, dir, opts) {
    const args = ["clone"];
    if (opts?.depth) args.push("--depth", String(opts.depth));
    if (opts?.branch) args.push("--branch", opts.branch);
    args.push(repoUrl, dir);
    const r = await runGit(args);
    assertOk(r, `clone ${repoUrl}`);
  },
  async add(dir, pathRel) {
    const r = await runGit(["add", "--", pathRel], dir);
    assertOk(r, `add ${pathRel}`);
  },
  async commit(dir, message) {
    // Check for staged changes first. `git diff --cached --quiet` exits 0
    // when there are NO changes (idempotent re-deploy) and 1 when there
    // ARE staged changes.
    const diff = await runGit(["diff", "--cached", "--quiet"], dir);
    if (diff.exitCode === 0) {
      const head = await runGit(["rev-parse", "HEAD"], dir);
      assertOk(head, "rev-parse HEAD");
      return { sha: head.stdout.trim(), committed: false };
    }
    const r = await runGit(["commit", "-m", message], dir);
    assertOk(r, "commit");
    const head = await runGit(["rev-parse", "HEAD"], dir);
    assertOk(head, "rev-parse HEAD");
    return { sha: head.stdout.trim(), committed: true };
  },
  async push(dir, opts) {
    const args = ["push", "origin"];
    if (opts?.branch) args.push(opts.branch);
    const r = await runGit(args, dir);
    assertOk(r, "push");
  },
  async headSha(dir) {
    const r = await runGit(["rev-parse", "HEAD"], dir);
    assertOk(r, "rev-parse HEAD");
    return r.stdout.trim();
  }
};
