import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushArgoApplicationToRepo, type GitClient } from "../src/gitops-repo.js";
import type { DeployArtifact } from "@atlas/workflow-engine";

const ARGO_YAML =
  "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: proj-1-main\nspec:\n  destination:\n    namespace: atlas-projects\n";

const DEPLOY: DeployArtifact = {
  schemaVersion: "1",
  kind: "deploy",
  target: "k8s",
  argoApplication: {
    file: "argo/proj-1-main.yaml",
    name: "proj-1-main",
    repoUrl: "git@example.com:atlas/gitops.git",
    path: "applications/",
    content: ARGO_YAML
  },
  imageBuilds: [],
  smokeTests: []
};

/**
 * makeFakeGitClient — records every call (in order) and writes nothing to
 * disk. The helper's responsibility to clone-then-write-then-add-commit-push
 * is enforced by inspecting the recorded order.
 *
 * `committed` defaults to true; pass `{ committed: false }` to simulate the
 * no-changes short-circuit.
 */
function makeFakeGitClient(opts: { committed?: boolean; sha?: string; head?: string } = {}): GitClient & {
  calls: Array<{ op: string; args: unknown[] }>;
} {
  const committed = opts.committed ?? true;
  const sha = opts.sha ?? "deadbeefcafef00d";
  const head = opts.head ?? "0000000000000000";
  const calls: Array<{ op: string; args: unknown[] }> = [];
  return {
    calls,
    clone: vi.fn(async (repoUrl: string, dir: string, o) => {
      calls.push({ op: "clone", args: [repoUrl, dir, o] });
    }),
    add: vi.fn(async (dir: string, pathRel: string) => {
      calls.push({ op: "add", args: [dir, pathRel] });
    }),
    commit: vi.fn(async (dir: string, message: string) => {
      calls.push({ op: "commit", args: [dir, message] });
      return { sha, committed };
    }),
    push: vi.fn(async (dir: string, o) => {
      calls.push({ op: "push", args: [dir, o] });
    }),
    headSha: vi.fn(async (dir: string) => {
      calls.push({ op: "headSha", args: [dir] });
      return head;
    })
  };
}

describe("pushArgoApplicationToRepo", () => {
  it("clones, writes the Application yaml, adds, commits with deployId, then pushes", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "atlas-gitops-test-"));
    try {
      const gitClient = makeFakeGitClient();
      const r = await pushArgoApplicationToRepo(
        { deployId: "deploy-abc", deployArtifact: DEPLOY },
        {
          repoUrl: "git@example.com:atlas/gitops.git",
          gitClient,
          workdir
        }
      );

      // Ordered call sequence — clone before write/add/commit/push.
      const ops = gitClient.calls.map((c) => c.op);
      expect(ops[0]).toBe("clone");
      // add/commit/push come AFTER clone (the file write happens between
      // clone and add but isn't a gitClient call).
      expect(ops.indexOf("add")).toBeGreaterThan(ops.indexOf("clone"));
      expect(ops.indexOf("commit")).toBeGreaterThan(ops.indexOf("add"));
      expect(ops.indexOf("push")).toBeGreaterThan(ops.indexOf("commit"));

      // Commit message must include the deployId for traceability.
      const commitCall = gitClient.calls.find((c) => c.op === "commit");
      expect(commitCall?.args[1]).toMatch(/deploy-abc/);

      // Result shape.
      expect(r.commitSha).toBe("deadbeefcafef00d");
      expect(r.committed).toBe(true);
      expect(r.repoUrl).toBe("git@example.com:atlas/gitops.git");
      expect(r.path).toBe("applications/proj-1-main.yaml");
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("writes the Application yaml content verbatim to the computed path", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "atlas-gitops-test-"));
    try {
      let writtenContent: string | undefined;
      let writtenPath: string | undefined;
      const gitClient: GitClient = {
        clone: vi.fn(async () => {
          /* no-op — leaves an empty dir */
        }),
        add: vi.fn(async (dir: string, pathRel: string) => {
          // The test reads back the file via readFile to confirm content+path.
          writtenPath = pathRel;
          writtenContent = await readFile(join(dir, pathRel), "utf8");
        }),
        commit: vi.fn(async () => ({ sha: "abc", committed: true })),
        push: vi.fn(async () => {}),
        headSha: vi.fn(async () => "0000")
      };
      await pushArgoApplicationToRepo(
        { deployId: "d-1", deployArtifact: DEPLOY },
        { repoUrl: "git@x:y.git", gitClient, workdir }
      );
      expect(writtenContent).toBe(ARGO_YAML);
      expect(writtenPath).toBe("applications/proj-1-main.yaml");
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns committed=false (no-changes short-circuit) when git client reports nothing to commit", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "atlas-gitops-test-"));
    try {
      const gitClient = makeFakeGitClient({ committed: false, head: "abcdef" });
      const r = await pushArgoApplicationToRepo(
        { deployId: "d-1", deployArtifact: DEPLOY },
        { repoUrl: "git@x:y.git", gitClient, workdir }
      );
      expect(r.committed).toBe(false);
      expect(r.commitSha).toBe("abcdef"); // fall back to headSha
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("respects custom appPath override", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "atlas-gitops-test-"));
    try {
      const gitClient = makeFakeGitClient();
      const r = await pushArgoApplicationToRepo(
        { deployId: "d-1", deployArtifact: DEPLOY },
        {
          repoUrl: "git@x:y.git",
          gitClient,
          workdir,
          appPath: "custom/sub/myapp.yaml"
        }
      );
      expect(r.path).toBe("custom/sub/myapp.yaml");
      const addCall = gitClient.calls.find((c) => c.op === "add");
      expect(addCall?.args[1]).toBe("custom/sub/myapp.yaml");
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("threads the branch option into clone and push", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "atlas-gitops-test-"));
    try {
      const gitClient = makeFakeGitClient();
      await pushArgoApplicationToRepo(
        { deployId: "d-1", deployArtifact: DEPLOY },
        { repoUrl: "git@x:y.git", gitClient, workdir, branch: "production" }
      );
      const cloneCall = gitClient.calls.find((c) => c.op === "clone");
      expect((cloneCall?.args[2] as { branch?: string } | undefined)?.branch).toBe("production");
      const pushCall = gitClient.calls.find((c) => c.op === "push");
      expect((pushCall?.args[1] as { branch?: string } | undefined)?.branch).toBe("production");
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("cleans up the temp clone dir on success", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "atlas-gitops-test-"));
    try {
      let observedDir: string | undefined;
      const gitClient: GitClient = {
        clone: vi.fn(async (_repoUrl, dir) => {
          observedDir = dir;
        }),
        add: vi.fn(async () => {}),
        commit: vi.fn(async () => ({ sha: "abc", committed: true })),
        push: vi.fn(async () => {}),
        headSha: vi.fn(async () => "0000")
      };
      await pushArgoApplicationToRepo(
        { deployId: "d-1", deployArtifact: DEPLOY },
        { repoUrl: "git@x:y.git", gitClient, workdir }
      );
      expect(observedDir).toBeDefined();
      await expect(stat(observedDir!)).rejects.toThrow(); // dir removed
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
