import { Octokit } from "@octokit/rest";

/**
 * Creates an authenticated Octokit instance.
 *
 * Reads GITHUB_TOKEN from the environment. In tests, pass a mock auth token;
 * the factory is exported so tests can inject their own instance instead.
 *
 * Never import this module in Client Components — it reads process.env and
 * must run only in Server Actions / Server Components.
 */
export function createOctokit(token?: string): Octokit {
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (!auth) {
    throw new Error(
      "GITHUB_TOKEN is not set. Add it to .env.local for local development " +
        "or to the Vercel environment for production."
    );
  }
  return new Octokit({ auth });
}

/**
 * Parses a GitHub repo URL or "owner/repo" string into { owner, repo }.
 * Accepts:
 *   - "octocat/hello-world"
 *   - "https://github.com/octocat/hello-world"
 *   - "https://github.com/octocat/hello-world.git"
 */
export function parseRepoSlug(repoSlugOrUrl: string): { owner: string; repo: string } {
  const cleaned = repoSlugOrUrl
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .trim();
  const [owner, repo] = cleaned.split("/");
  if (!owner || !repo) {
    throw new Error(`Cannot parse repo slug: "${repoSlugOrUrl}"`);
  }
  return { owner, repo };
}
