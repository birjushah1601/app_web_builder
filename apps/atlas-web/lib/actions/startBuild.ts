"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { classifyEntry } from "@/lib/llm/classify-entry";
import { getLlmProvider } from "@/lib/llm/factory";
import { startRitual } from "./startRitual";
import { startWorkflow } from "./startWorkflow";

export interface StartBuildInput {
  projectId: string;
  prompt: string;
  artifactKindHint?: string;
}

export type StartBuildResult =
  | { kind: "ritual"; ritualId: string }
  | {
      kind: "workflow";
      workflowRunId: string;
      suggestedKinds: string[];
      reasoning: string;
    };

const ALL_KINDS = new Set([
  "frontend-app",
  "backend-rest-api",
  "backend-graphql",
  "tests",
  "iac",
  "deploy",
  "data-pipeline",
  "mobile-app",
  "cli-tool"
]);

export function readKindsAllowList(): Set<string> {
  const csv = process.env.ATLAS_FF_WORKFLOW_KINDS;
  if (!csv) return new Set(ALL_KINDS);
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export async function startBuild(input: StartBuildInput): Promise<StartBuildResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  // Master flag OFF → always single-ritual (today's path)
  if (!isFeatureEnabled("workflow")) {
    const r = await startRitual({
      projectId: input.projectId,
      userTurn: input.prompt,
      editClass: "structural",
      ...(input.artifactKindHint
        ? { artifactKindHint: input.artifactKindHint as never }
        : {})
    });
    return { kind: "ritual", ritualId: r.ritualId };
  }

  // Classifier verdict
  const llm = await getLlmProvider();
  let verdict: Awaited<ReturnType<typeof classifyEntry>>;
  try {
    if (!llm) throw new Error("no LLM provider configured");
    verdict = await classifyEntry(
      {
        prompt: input.prompt,
        ...(input.artifactKindHint ? { artifactKindHint: input.artifactKindHint } : {})
      },
      llm
    );
  } catch (err) {
    // Fail-safe: fall back to single-ritual on classifier error
    console.warn("[atlas-web] classifyEntry failed; falling back to single-ritual", err);
    const r = await startRitual({
      projectId: input.projectId,
      userTurn: input.prompt,
      editClass: "structural"
    });
    return { kind: "ritual", ritualId: r.ritualId };
  }

  // Filter suggestedKinds by ATLAS_FF_WORKFLOW_KINDS allow-list
  const kindsAllowList = readKindsAllowList();
  const suggestedKinds = (verdict.suggestedKinds ?? []).filter((k) => kindsAllowList.has(k));

  if (verdict.mode === "workflow" && suggestedKinds.length > 0) {
    const w = await startWorkflow({
      projectId: input.projectId,
      prompt: input.prompt,
      suggestedKinds
    });
    return {
      kind: "workflow",
      workflowRunId: w.workflowRunId,
      suggestedKinds,
      reasoning: verdict.reasoning
    };
  }

  const r = await startRitual({
    projectId: input.projectId,
    userTurn: input.prompt,
    editClass: "structural"
  });
  return { kind: "ritual", ritualId: r.ritualId };
}
