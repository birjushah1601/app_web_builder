"use server";

import { auth } from "@clerk/nextjs/server";
import { createOctokit, parseRepoSlug } from "../../code/octokitClient.js";

export interface Pr {
  number: number;
  title: string;
  state: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
}

export interface ListPrsInput {
  projectId: string;
  repoSlug: string;
  state?: "open" | "closed" | "all";
}

export async function listPrs(input: ListPrsInput): Promise<Pr[]> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const octokit = createOctokit();
  const { owner, repo } = parseRepoSlug(input.repoSlug);
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: input.state ?? "open",
    per_page: 30,
  });

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    html_url: pr.html_url,
    head: { ref: pr.head.ref },
    base: { ref: pr.base.ref },
  }));
}
