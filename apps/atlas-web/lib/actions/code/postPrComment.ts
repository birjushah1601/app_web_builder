"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { createOctokit, parseRepoSlug } from "../../code/octokitClient.js";

export interface PostPrCommentInput {
  projectId: string;
  repoSlug: string;
  prNumber: number;
  body: string;
}

export interface PostPrCommentResult {
  commentId: number;
}

export async function postPrComment(input: PostPrCommentInput): Promise<PostPrCommentResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: input.prNumber,
    body: input.body,
  });

  return { commentId: data.id };
}
