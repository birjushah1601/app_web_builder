"use server";

import { redirect } from "next/navigation";
import { Pool } from "pg";
import { ProjectsRepo } from "@atlas/spec-graph-data";
import type { ArtifactKind } from "@atlas/canvas-runtime";
import { auth } from "@/lib/auth/clerk-compat";
import { startRitual } from "@/lib/actions/startRitual";
import { deriveName } from "@/lib/projects/derive-name";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getSandboxFactory } from "@/lib/sandbox/factory";

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

  // D18a — Pre-warm the E2B sandbox at project creation time so the cold
  // start (~230-300s on Next templates) is overlapped with the architect +
  // designer + asset-gen passes instead of sitting on the critical path
  // right before the developer role tries to apply its diff. Fire-and-forget
  // — `getSandboxFactory().getOrProvision` caches by projectId and coalesces
  // in-flight calls, so the later developer-time call either reads the
  // warm session from cache or awaits this same promise. Zero contract
  // change for the developer-role / sandboxApplier path. Failure-safe:
  // logged + swallowed so a flaky E2B never blocks project creation.
  if (isFeatureEnabled("sandbox-prewarm")) {
    void getSandboxFactory()
      .getOrProvision(project.projectId)
      .catch((err) => {
        console.warn(
          "[submitPromptedProject] sandbox pre-warm failed (non-fatal; developer-role will provision lazily):",
          err instanceof Error ? err.message : String(err)
        );
      });
  }

  // Plan SPU + UXO Task 6 — collect reference URLs the ReferenceDropZone
  // posted as `reference[]` hidden inputs. URLs are content-addressed and
  // served by the /api/atlas-references/[hash] route. Empty array when the
  // reference-input flag is off (no drop zone, no hidden inputs) — engine
  // then omits referenceImages from priorArtifact (no behavior change).
  const referenceImages: ReadonlyArray<{ url: string; caption?: string }> = formData
    .getAll("reference[]")
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((url) => ({ url }));

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
