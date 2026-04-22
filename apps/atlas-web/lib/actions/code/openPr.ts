"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { createOctokit, parseRepoSlug } from "../../code/octokitClient.js";

export interface OpenPrInput {
  projectId: string;
  repoSlug: string;
  head: string;
  base: string;
  title: string;
  body?: string;
}

export interface OpenPrResult {
  prNumber: number;
  prUrl: string;
}

export async function openPr(input: OpenPrInput): Promise<OpenPrResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  // TODO(E.4): trigger sandbox git-push for `input.head` branch before opening PR
  // The E2B sandbox must have pushed the branch to the remote before this call.

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
