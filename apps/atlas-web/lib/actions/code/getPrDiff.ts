"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { createOctokit, parseRepoSlug } from "../../code/octokitClient";

export interface GetPrDiffInput {
  projectId: string;
  repoSlug: string;
  prNumber: number;
}

export interface GetPrDiffResult {
  diff: string;
}

export async function getPrDiff(input: GetPrDiffInput): Promise<GetPrDiffResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);

  // GitHub API returns unified diff when Accept header is application/vnd.github.diff
  const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: input.prNumber,
    headers: { accept: "application/vnd.github.diff" },
  });

  return { diff: String(response.data) };
}
