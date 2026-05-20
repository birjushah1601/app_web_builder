"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { createOctokit, parseRepoSlug } from "../../code/octokitClient";
import { getSandboxFactory } from "@/lib/sandbox/factory";

export interface OpenPrInput {
  projectId: string;
  repoSlug: string;
  head: string;
  base: string;
  title: string;
  body?: string;
}

export type OpenPrResult =
  | {
      prNumber: number;
      prUrl: string;
    }
  | {
      status: "push_failed";
      stdout: string;
      stderr: string;
      exitCode: number;
    };

const PUSH_TIMEOUT_MS = 30_000;

/** Minimal shape of the E2B v2.5 commands API we rely on. Kept local so the
 *  Server Action does not couple to @e2b/sdk types directly — same pattern
 *  used by lib/engine/factory.ts when invoking the Visual-Quality role. */
interface E2BCommands {
  run(
    cmd: string,
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      envs?: Record<string, string>;
      background?: false;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

interface E2BConnectable {
  commands: E2BCommands;
}

export async function openPr(input: OpenPrInput): Promise<OpenPrResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  // E.4: push the working branch from the project's E2B sandbox to GitHub
  // before asking the API to open a PR. Without this, the head ref does not
  // exist on the remote and pulls.create() 404s.
  const session = await getSandboxFactory().getOrProvision(input.projectId);
  const { Sandbox } = await import("@e2b/sdk");
  const sdk = (await Sandbox.connect(session.record.sandboxId, {
    apiKey: process.env.E2B_API_KEY ?? "",
  })) as unknown as E2BConnectable;

  // GITHUB_TOKEN is read from the Server Action's process.env (same env the
  // octokit client uses) and forwarded into the sandbox process via the
  // `envs` option on commands.run. The factory does not bake the token into
  // the sandbox itself — we inject it per-command so it never lingers in the
  // sandbox shell history.
  const githubToken = process.env.GITHUB_TOKEN ?? "";
  const pushResult = await sdk.commands.run(
    `cd /code && git push -u origin ${input.head}`,
    {
      timeoutMs: PUSH_TIMEOUT_MS,
      envs: githubToken ? { GITHUB_TOKEN: githubToken } : {},
    }
  );

  if (pushResult.exitCode !== 0) {
    return {
      status: "push_failed",
      stdout: pushResult.stdout,
      stderr: pushResult.stderr,
      exitCode: pushResult.exitCode,
    };
  }

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    head: input.head,
    base: input.base,
    title: input.title,
    body: input.body ?? "",
  });

  return { prNumber: data.number, prUrl: data.html_url };
}
