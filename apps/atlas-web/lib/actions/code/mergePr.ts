"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { createOctokit, parseRepoSlug } from "../../code/octokitClient.js";

export interface MergePrInput {
  projectId: string;
  repoSlug: string;
  prNumber: number;
  mergeMethod?: "merge" | "squash" | "rebase";
}

export interface MergePrResult {
  sha: string;
  merged: boolean;
}

export async function mergePr(input: MergePrInput): Promise<MergePrResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.pulls.merge({
    owner,
    repo,
    pull_number: input.prNumber,
    merge_method: input.mergeMethod ?? "squash",
  });

  return { sha: data.sha, merged: data.merged };
}
