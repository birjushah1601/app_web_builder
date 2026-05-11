import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { buildPromptCacheBlocks } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { isPriorRitualContext, type PriorRitualContext } from "@atlas/ritual-engine";
import {
  defaultManifestForArtifactKind,
  type ArtifactKind,
  type CanvasManifest
} from "@atlas/canvas-runtime";
import { assembleArchitectPrompt } from "./assemble-prompt.js";
import { DeepPlanFailedError } from "./errors.js";
import {
  ArchitectOutputSchema,
  type AmbiguityReport,
  type ArchitectOutput
} from "./types.js";

export const ARCHITECT_DEEP_PLAN_MODEL = "claude-opus-4-7";

export interface DeepPlanInput {
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  ambiguity: AmbiguityReport;
  skills: SkillRegistry;
  llm: LLMProvider;
  deepPlanModel?: string;
  /** Plan PFP: when the user supplied an artifactKindHint at ritual start
   *  (e.g. picked "Website" on the prompt-first form), the role extracts it
   *  from inv.priorArtifact and forwards it here. enrichArchitectOutput uses
   *  it as the canvasManifest.artifactKind, short-circuiting the implicit
   *  classification that would otherwise be derived from specGraph.kind. */
  artifactKindHint?: ArtifactKind;
  /** Plan K: when refining a prior ritual, the engine threads the parent's
   *  PriorRitualContext through here. The prompt prepends a "Previous turn"
   *  section so the model builds on the prior plan + diff instead of starting
   *  from scratch. Other shapes are silently ignored. */
  priorRitual?: unknown;
  /** Snapshot of the current sandbox files the architect should be aware of
   *  on a cold start (and on refines too). Each entry is a path + optional
   *  content. When present, the prompt prepends a "## Current sandbox files"
   *  section enumerating paths and inlining the contents of small files
   *  (truncated head 2k + tail 2k for any file ≥ 4KB so prompt budget stays
   *  bounded). Absent → the section is omitted entirely (today's behavior). */
  currentFiles?: CurrentFileEntry[];
}

/** Snapshot of one file in the current sandbox the architect should be aware of. */
export interface CurrentFileEntry {
  path: string;
  /** UTF-8 content. Optional — when absent, the file is listed by path only
   *  (useful for "this file exists but its content is too large / binary").
   *  When present and ≥ FILE_TRUNCATE_MAX chars, renderCurrentFilesSection
   *  truncates with a head/tail elision marker. */
  content?: string;
}

/** Per-file character budget — files above this get head-2k + tail-2k elision.
 *  Mirrors the DIFF_TRUNCATE_MAX pattern in prior-ritual-context.ts. */
const FILE_TRUNCATE_MAX = 4000;

/** Plan K: pure helper that builds the architect's userTurn string. When
 *  priorRitual is a real PriorRitualContext, prepends a "Previous turn"
 *  preamble with parent's plan + diff. When currentFiles is non-empty,
 *  prepends a "## Current sandbox files" section so the architect can
 *  reason about the existing tree even on a cold start. Exported for unit
 *  testing. */
export function buildArchitectUserTurn(input: {
  userTurn: string;
  scope: string;
  priorRitual?: unknown;
  currentFiles?: CurrentFileEntry[];
}): string {
  const sections: string[] = [];

  if (input.currentFiles && input.currentFiles.length > 0) {
    sections.push(renderCurrentFilesSection(input.currentFiles));
  }

  if (isPriorRitualContext(input.priorRitual)) {
    sections.push(renderPriorRitualSection(input.priorRitual));
    // Plan L: when the prior ritual carries failed gate reports, render a
    // dedicated "## Gate findings" section so the model sees the issues
    // verbatim, not buried inside a JSON-dump artifact.
    const gateFindings = renderGateFindingsSection(input.priorRitual);
    if (gateFindings) sections.push(gateFindings);
  }

  sections.push(`Scope: ${input.scope}\n\nUser intent: ${input.userTurn}`);

  return sections.join("\n\n---\n\n");
}

/** Render a "## Current sandbox files" section enumerating the files the
 *  architect should be aware of. Files ≥ FILE_TRUNCATE_MAX chars are
 *  truncated to head-2k + tail-2k with an elision marker — mirrors the
 *  DIFF_TRUNCATE_MAX pattern in prior-ritual-context.ts. Files with no
 *  `content` are listed by path only. */
function renderCurrentFilesSection(files: CurrentFileEntry[]): string {
  const lines: string[] = [
    "## Current sandbox files",
    "",
    "These files already exist in the project's live sandbox. Build on them — do not duplicate or recreate from scratch.",
    ""
  ];
  for (const f of files) {
    if (f.content === undefined) {
      lines.push(`### ${f.path}`, "", "_(content not loaded)_", "");
      continue;
    }
    let body = f.content;
    if (body.length > FILE_TRUNCATE_MAX) {
      const half = FILE_TRUNCATE_MAX / 2;
      const head = body.slice(0, half);
      const tail = body.slice(-half);
      const elided = body.length - FILE_TRUNCATE_MAX;
      body = `${head}\n... [${elided} chars elided] ...\n${tail}`;
    }
    lines.push(`### ${f.path}`, "", "```", body, "```", "");
  }
  return lines.join("\n").trimEnd();
}

interface GateIssue {
  severity?: string;
  message?: string;
}
interface GateReport {
  passed?: boolean;
  issues?: GateIssue[];
}

function renderGateFindingsSection(prior: PriorRitualContext): string | null {
  const sec = prior.parentSecurityReport as GateReport | undefined;
  const a11y = prior.parentAccessibilityReport as GateReport | undefined;
  const secFails = sec && sec.passed === false && Array.isArray(sec.issues) && sec.issues.length > 0;
  const a11yFails = a11y && a11y.passed === false && Array.isArray(a11y.issues) && a11y.issues.length > 0;
  if (!secFails && !a11yFails) return null;

  const lines: string[] = [
    "## Gate findings",
    "",
    "The following gate failures must be addressed:"
  ];
  if (secFails) {
    lines.push("", "### L4 Security");
    for (const i of sec!.issues!) {
      lines.push(`- [${i.severity ?? "unknown"}] ${i.message ?? "(no message)"}`);
    }
  }
  if (a11yFails) {
    lines.push("", "### L5 Accessibility");
    for (const i of a11y!.issues!) {
      lines.push(`- [${i.severity ?? "unknown"}] ${i.message ?? "(no message)"}`);
    }
  }
  return lines.join("\n");
}

function renderPriorRitualSection(prior: PriorRitualContext): string {
  const lines: string[] = [
    "## Previous turn",
    "",
    `In a prior turn (ritualId=${prior.parentRitualId}), you produced this plan:`,
    "",
    "```json",
    JSON.stringify(prior.parentArtifact ?? null, null, 2),
    "```"
  ];
  if (prior.parentDeveloperOutput) {
    lines.push(
      "",
      "And the developer wrote this diff:",
      "",
      "```diff",
      prior.parentDeveloperOutput.diff,
      "```"
    );
    if (prior.parentDeveloperOutput.summary) {
      lines.push("", `Summary: ${prior.parentDeveloperOutput.summary}`);
    }
  }
  lines.push(
    "",
    "The user has now provided a follow-up request — produce an updated plan that builds on the previous work."
  );
  return lines.join("\n");
}

const DEEP_PLAN_ROLE_PROMPT = `You are the Architect's deep-plan pass. Given a clarified user intent
and a Spec Graph slice, produce the scope-specific Visualize artifact per PRD §8:

- new-app → SpecGraph + wireframes + data model + flows + compliance class
- new-feature → impact-analysis diff plan
- bug-fix → four-phase debug report (reproduce → isolate → hypothesize → verify)
- dep-upgrade → breaking-change matrix + rollback plan
- refactor → before/after graph + behavior-preservation contract + regression tests
- ship → rerunnable steps + rollback trigger
- migrate → staged plan + compliance evidence

Compose brainstorm + spec-graph + runnable-plan skills as reference material.
Call the emit_architect_output tool exactly once with the scope-matched output.`;

const DEEP_PLAN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      enum: ["new-app", "new-feature", "bug-fix", "dep-upgrade", "refactor", "ship", "migrate"]
    },
    // Accept either shape; strict enforcement happens via Zod after the tool returns.
  },
  required: ["scope"]
} as const;

export async function deepPlan(input: DeepPlanInput): Promise<ArchitectOutput> {
  let skillPrompt: string;
  try {
    skillPrompt = assembleArchitectPrompt(input.skills, ["brainstorm", "spec-graph", "runnable-plan"]);
  } catch (err) {
    throw new DeepPlanFailedError(`required skill missing: ${(err as Error).message}`, {
      cause: err,
      scope: input.ambiguity.scope
    });
  }

  const model = input.deepPlanModel ?? ARCHITECT_DEEP_PLAN_MODEL;
  const roleSystem = `${DEEP_PLAN_ROLE_PROMPT}\n\n# Reference skills\n\n${skillPrompt}`;

  const messages = buildPromptCacheBlocks({
    rolePrompt: roleSystem,
    graphSlice: input.graphSlice,
    userTurn: buildArchitectUserTurn({
      userTurn: input.userTurn,
      scope: input.ambiguity.scope,
      priorRitual: input.priorRitual,
      ...(input.currentFiles !== undefined ? { currentFiles: input.currentFiles } : {})
    })
  });

  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model,
      maxTokens: 8192,
      tools: [
        {
          name: "emit_architect_output",
          description: "Emit the scope-specific Visualize artifact",
          input_schema: DEEP_PLAN_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_architect_output" }
    });
  } catch (err) {
    const causeMsg = err instanceof Error ? err.message : String(err);
    throw new DeepPlanFailedError(`deep plan LLM call failed: ${causeMsg}`, { cause: err, scope: input.ambiguity.scope });
  }

  // Defensive enrichment for all scope variants. Models against tools-
  // stripping proxies routinely omit required scope-specific fields
  // (graphSlice, runnablePlan, diffPlan, bugReport, etc.). Rather than
  // failing the entire ritual one missing field at a time, we inject
  // empty-but-valid defaults for whichever scope the model picked, then
  // overlay the model's actual output on top. The model's real values
  // win wherever it provided them; missing fields get safe placeholders
  // so the schema parse succeeds and downstream consumers (UI, plan C
  // sandbox apply) keep functioning.
  const enriched = enrichArchitectOutput(
    result.input,
    input.graphSlice,
    input.ambiguity.scope,
    input.artifactKindHint
  );

  const parse = ArchitectOutputSchema.safeParse(enriched);
  if (!parse.success) {
    throw new DeepPlanFailedError(
      `deep plan tool_use payload failed ArchitectOutputSchema: ${parse.error.message}`,
      { cause: parse.error, scope: input.ambiguity.scope }
    );
  }
  return parse.data;
}

/** Build empty-but-valid defaults for each scope variant, then overlay the
 *  model's actual output. The model's values always win — defaults only fill
 *  in fields the model omitted. graphSlice is special: always overridden with
 *  the operator-supplied value (the model has no business inventing it). */
function enrichArchitectOutput(
  raw: unknown,
  graphSlice: { bytes: string; hash: string },
  scope: string,
  artifactKindHint?: ArtifactKind
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const model = raw as Record<string, unknown>;
  const defaults = scopeDefaults(scope);
  const merged = { ...defaults, ...model, scope, graphSlice } as Record<string, unknown>;
  // Plan S.4: synthesize a CanvasManifest when the architect didn't supply
  // one and the scope is design-affecting. The manifest tells the engine
  // which canvas modes the user can pick; design-blocking modes pause the
  // ritual until the user selects a direction.
  // Plan PFP: when an artifactKindHint was supplied by the user at ritual
  // start, prefer the hint over specGraph.kind so we don't re-classify a
  // value the user already picked on the prompt-first form.
  if (!("canvasManifest" in model)) {
    const manifest = synthesizeCanvasManifest(scope, merged, artifactKindHint);
    if (manifest) merged.canvasManifest = manifest;
  }
  return merged;
}

/** Plan S.4: Synthesize a CanvasManifest from the architect's scope + artifact.
 *  Returns undefined when the scope is not user-facing (refactor, ship,
 *  migrate, bug-fix, dep-upgrade) OR when the resolved artifactKind isn't
 *  one we have a default manifest for.
 *
 *  Plan PFP: when artifactKindHint is provided, it overrides
 *  specGraph.kind — the user already picked the kind on the prompt-first
 *  form, so we skip the implicit classification step. */
export function synthesizeCanvasManifest(
  scope: string,
  model: Record<string, unknown>,
  artifactKindHint?: ArtifactKind
): CanvasManifest | undefined {
  if (!["new-app", "new-feature"].includes(scope)) return undefined;
  const specGraph = model.specGraph as { kind?: string } | undefined;
  const kind = artifactKindHint ?? specGraph?.kind ?? "frontend-app";
  const valid: ArtifactKind[] = [
    "frontend-app",
    "backend-rest-api",
    "backend-graphql",
    "data-pipeline",
    "mobile-app",
    "cli-tool"
  ];
  if (!valid.includes(kind as ArtifactKind)) return undefined;
  return defaultManifestForArtifactKind(kind as ArtifactKind);
}

function scopeDefaults(scope: string): Record<string, unknown> {
  switch (scope) {
    case "new-app":
      return { specGraph: {}, runnablePlan: { tasks: [] } };
    case "new-feature":
      return { diffPlan: { summary: "", tasks: [] } };
    case "bug-fix":
      return {
        bugReport: {
          phase1_reproduce: "",
          phase2_isolate: "",
          phase3_hypothesize: "",
          phase4_verify: "",
          rootCause: ""
        }
      };
    case "dep-upgrade":
      return { breakingChangeMatrix: [], rollbackPlan: "" };
    case "refactor":
      return {
        beforeAfterGraph: { before: {}, after: {} },
        behaviorPreservationContract: [],
        regressionTests: []
      };
    case "ship":
      return { rerunnableSteps: [], rollbackTrigger: "" };
    case "migrate":
      return { stagedPlan: [], complianceEvidence: [] };
    default:
      return {};
  }
}
