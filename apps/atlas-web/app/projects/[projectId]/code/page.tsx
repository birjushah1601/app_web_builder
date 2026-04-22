import React from "react";
import { auth } from "@/lib/auth/clerk-compat.js";
import { redirect } from "next/navigation";
import { listMirroredFiles } from "@atlas/spec-graph-sync";
import { CodeLayout } from "@/components/code/CodeLayout";

interface CodePageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ repo?: string }>;
}

/**
 * Server Component — root of the Code view.
 *
 * Responsibilities:
 * 1. Gate: unauthenticated users are redirected to /sign-in (Clerk).
 * 2. Fetch initial file list from @atlas/spec-graph-sync (server-side; no waterfall).
 * 3. Render CodeLayout (Client Component) with the file list + repo slug.
 *
 * The `repo` search param carries the GitHub "owner/repo" slug (e.g. "acme/my-app").
 * It is set by the project settings screen (E.2). When absent, PR actions degrade
 * gracefully (they show "no repo connected" placeholder).
 */
export default async function CodePage({ params, searchParams }: CodePageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { projectId } = await params;
  const { repo } = await searchParams;
  const repoSlug = repo ?? "";

  let files: string[] = [];
  try {
    files = await listMirroredFiles({ projectId });
  } catch {
    // Mirror may not have files yet (new project). CodeLayout shows empty state.
  }

  return (
    <CodeLayout
      projectId={projectId}
      repoSlug={repoSlug}
      files={files}
    />
  );
}
