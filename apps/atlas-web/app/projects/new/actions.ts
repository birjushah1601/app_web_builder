"use server";

import { redirect } from "next/navigation";
import { Pool } from "pg";
import { ProjectsRepo } from "@atlas/spec-graph-data";
import type { ArtifactKind } from "@atlas/canvas-runtime";
import { auth } from "@/lib/auth/clerk-compat";
import { startRitual } from "@/lib/actions/startRitual";
import { deriveName } from "@/lib/projects/derive-name";

const VALID_KINDS: ReadonlySet<string> = new Set([
  "frontend-app",
  "backend-rest-api",
  "mobile-app",
  "data-pipeline"
]);

export async function submitPromptedProject(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) throw new Error("prompt required");

  const kindRaw = String(formData.get("kind") ?? "auto");
  const artifactKindHint: ArtifactKind | undefined =
    VALID_KINDS.has(kindRaw) ? (kindRaw as ArtifactKind) : undefined;

  const name = deriveName(prompt);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const project = await new ProjectsRepo(pool).create({ userId, name });

  // Plan SPU — stub field for reference imagery. UI upload widget lives in a
  // separate slice; for now we read whatever the form posts (today: nothing,
  // so the array is empty) and pass it through so the call chain accepts the
  // field. Empty array → engine omits it from priorArtifact (no behavior change).
  const referenceImages: ReadonlyArray<{ url: string; caption?: string }> = [];

  // Fire-and-forget — the user shouldn't wait at submit. Canvas page picks
  // up the architect's first events via SSE the moment they fire.
  void startRitual({
    projectId: project.projectId,
    userTurn: prompt,
    // EditClass for a brand-new project is "structural" (full feature work).
    // The architect re-classifies internally on pass1; this is the up-front
    // guess that determines whether the canvas-pause flow engages.
    editClass: "structural",
    ...(artifactKindHint ? { artifactKindHint } : {}),
    referenceImages
  }).catch((err) => {
    console.error("[submitPromptedProject] startRitual failed:", err);
  });

  redirect(`/projects/${project.projectId}/canvas`);
}
