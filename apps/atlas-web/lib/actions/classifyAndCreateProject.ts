"use server";

import { Pool } from "pg";
import { ProjectsRepo } from "@atlas/spec-graph-data";
import { auth } from "@/lib/auth/clerk-compat";
import { deriveName } from "@/lib/projects/derive-name";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { classifyEntry } from "@/lib/llm/classify-entry";
import { getLlmProvider } from "@/lib/llm/factory";

export interface ClassifyAndCreateProjectResult {
  projectId: string;
  mode: "ritual" | "workflow";
  suggestedKinds: string[];
  reasoning: string;
}

/**
 * Plan G Task 8 — create the project and classify the prompt WITHOUT starting
 * any ritual or workflow. The client (WorkflowPickerChecklist) renders the
 * verdict so the user can confirm/adjust the kind list before kicking off the
 * actual build via a subsequent action.
 *
 * Mirrors `submitPromptedProject`'s steps 1-4 (auth + prompt validation +
 * project creation + sandbox pre-warm + classify) but stops short of starting
 * the ritual and does not redirect.
 *
 * Fail-safe: if the classifier throws, we still return a usable verdict with
 * `mode: "ritual"` so the client gets something to render. The error is logged
 * and swallowed.
 */
export async function classifyAndCreateProject(
  formData: FormData
): Promise<ClassifyAndCreateProjectResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) throw new Error("prompt required");

  const name = deriveName(prompt);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const project = await new ProjectsRepo(pool).create({ userId, name });

  // D18a — Pre-warm the E2B sandbox at project creation time so the cold
  // start (~230-300s) is overlapped with the architect + designer + asset-gen
  // passes. Fire-and-forget — failures are logged and swallowed so a flaky
  // E2B never blocks project creation. Mirrors submitPromptedProject.
  if (isFeatureEnabled("sandbox-prewarm")) {
    void getSandboxFactory()
      .getOrProvision(project.projectId)
      .catch((err) => {
        console.warn(
          "[classifyAndCreateProject] sandbox pre-warm failed (non-fatal; developer-role will provision lazily):",
          err instanceof Error ? err.message : String(err)
        );
      });
  }

  // Classifier verdict. Fail-safe: any error → single-ritual fallback so the
  // client always gets a usable verdict to render the picker against.
  try {
    const llm = await getLlmProvider();
    if (!llm) throw new Error("no LLM provider configured");
    const verdict = await classifyEntry({ prompt }, llm);
    return {
      projectId: project.projectId,
      mode: verdict.mode === "workflow" ? "workflow" : "ritual",
      suggestedKinds: verdict.suggestedKinds ?? [],
      reasoning: verdict.reasoning
    };
  } catch (err) {
    console.warn(
      "[classifyAndCreateProject] classifyEntry failed; falling back to single-ritual",
      err instanceof Error ? err.message : String(err)
    );
    return {
      projectId: project.projectId,
      mode: "ritual",
      suggestedKinds: [],
      reasoning: "classifier failed; falling back to single-ritual"
    };
  }
}
