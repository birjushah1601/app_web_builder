import { spawn } from "node:child_process";
import type { DeployArtifact } from "@atlas/workflow-engine";

/**
 * Plan F.4 — Image build + push helper.
 *
 * Builds + pushes every image declared on a DeployArtifact via shell-out to
 * docker. Runner is injectable so tests can assert command shape without
 * actually invoking docker; the default runner wraps child_process.spawn.
 *
 * Sequential v1 — parallel builds are a polish task once we have a real
 * registry in CI. Per-image fail-soft: a build failure does NOT stop the
 * loop; every image gets a result. The caller (runDeployFromArtifacts)
 * decides whether to throw based on the aggregate (any !ok → throw).
 */

export interface ImageBuilderResult {
  serviceName: string;
  imageTag: string;
  digest?: string;
  ok: boolean;
  error?: string;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface BuildAndPushImagesOptions {
  runner?: CommandRunner;
  /** docker build context root. Defaults to process.cwd(). */
  cwd?: string;
  /** Per-image build+push timeout. Default 10 minutes. */
  perBuildTimeoutMs?: number;
  /** Build only — don't push. Useful for local + tests. */
  skipPush?: boolean;
}

const DEFAULT_TIMEOUT_MS = 600_000;
/** Standard `docker push` stdout line we want to capture as the canonical
 *  registry-side digest. Format: `<tag>: digest: sha256:<hex> size: <int>`. */
const DIGEST_RE = /digest:\s*(sha256:[a-f0-9]+)/i;

export const defaultCommandRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolveExec, rejectExec) => {
    // env is inherited so operators' docker login / DOCKER_BUILDKIT / registry
    // creds carry through. cwd defaults to caller-supplied (or process.cwd()).
    const child = spawn(cmd, args, { cwd: opts?.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    if (opts?.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectExec(new Error(`command timed out after ${opts.timeoutMs}ms: ${cmd} ${args.join(" ")}`));
      }, opts.timeoutMs);
    }
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolveExec({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      rejectExec(err);
    });
  });

export async function buildAndPushImages(
  images: DeployArtifact["imageBuilds"],
  opts: BuildAndPushImagesOptions = {}
): Promise<ImageBuilderResult[]> {
  const runner = opts.runner ?? defaultCommandRunner;
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.perBuildTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: ImageBuilderResult[] = [];

  for (const img of images) {
    // ── build ──────────────────────────────────────────────────────────────
    const buildArgs = ["build", "-t", img.imageTag, "-f", img.dockerfilePath, cwd];
    const buildRes = await runner("docker", buildArgs, { cwd, timeoutMs }).catch((err: Error) => ({
      stdout: "",
      stderr: err.message,
      exitCode: -1
    }));

    if (buildRes.exitCode !== 0) {
      results.push({
        serviceName: img.serviceName,
        imageTag: img.imageTag,
        ok: false,
        error: (buildRes.stderr || buildRes.stdout || `docker build exit ${buildRes.exitCode}`).trim()
      });
      continue;
    }

    // ── push (or skip) ─────────────────────────────────────────────────────
    if (opts.skipPush) {
      results.push({ serviceName: img.serviceName, imageTag: img.imageTag, ok: true });
      continue;
    }

    const pushRes = await runner("docker", ["push", img.imageTag], { cwd, timeoutMs }).catch((err: Error) => ({
      stdout: "",
      stderr: err.message,
      exitCode: -1
    }));

    if (pushRes.exitCode !== 0) {
      results.push({
        serviceName: img.serviceName,
        imageTag: img.imageTag,
        ok: false,
        error: (pushRes.stderr || pushRes.stdout || `docker push exit ${pushRes.exitCode}`).trim()
      });
      continue;
    }

    const digestMatch = DIGEST_RE.exec(pushRes.stdout);
    results.push({
      serviceName: img.serviceName,
      imageTag: img.imageTag,
      ok: true,
      ...(digestMatch?.[1] ? { digest: digestMatch[1] } : {})
    });
  }

  return results;
}
