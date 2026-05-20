import type { LLMProvider, LLMMessage } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { anthropicPass, DEVELOPER_ANTHROPIC_MODEL } from "./anthropic-pass.js";
import { googlePass, DEVELOPER_GOOGLE_MODEL } from "./google-pass.js";
import { reviewerVote, DEVELOPER_REVIEWER_MODEL } from "./reviewer-vote.js";
import { BothProvidersFailedError } from "./errors.js";
import type { DeveloperOutput } from "./types.js";
import { renderFocusedRefineUserTurn, FOCUSED_REFINE_SYSTEM_PROMPT } from "./render-focused-refine.js";

export interface DeveloperRoleOptions {
  anthropic: LLMProvider;
  google: LLMProvider;
  reviewer: LLMProvider; // typically same as anthropic; injected for testing
  skills: SkillRegistry;
  anthropicModel?: string;
  googleModel?: string;
  reviewerModel?: string;
  /** "parallel" (default) fires both passes via Promise.all — best with two
   *  distinct providers (real Anthropic + real Google) where doubling load
   *  is fine. "sequential" runs anthropic, then google, then reviewer —
   *  recommended when both slots point at the same provider (e.g. local
   *  proxy) to avoid hammering one endpoint with concurrent requests.
   *  Default: "parallel". */
  parallelMode?: "parallel" | "sequential";
  /** Plan T.1 — selects the per-template developer prompt fragment from
   *  the sandbox-context-registry. Undefined / unknown → falls back to
   *  the default (atlas-next-ts-v2). Examples: "atlas-next-ts-v2",
   *  "atlas-fastapi". atlas-web's engine wiring sets this from
   *  resolveTemplateForRitual({ artifactKind }). */
  targetTemplate?: string;
}

export class DeveloperRole implements Role {
  readonly id = "developer";
  private readonly opts: DeveloperRoleOptions;
  constructor(opts: DeveloperRoleOptions) { this.opts = opts; }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    // focusedRefine branch: single-pass LLM call scoped to one element.
    // Triggered when priorArtifact.focusedRefine === true. Skips the parallel
    // Anthropic + Google pass and the reviewer vote entirely.
    const focusedRefine = (inv.priorArtifact as { focusedRefine?: boolean } | null | undefined)?.focusedRefine;
    if (focusedRefine === true) {
      return this.runFocusedRefine(inv);
    }

    const events: RoleOutput["events"] = [];
    events.push({ eventType: "developer.dispatch.started", payload: { ritualId: inv.ritualId } });

    // Read the architect artifact from RoleInvocation.priorArtifact (set by
    // the conductor when this role is dispatched as the second step in a
    // ritual chain). Unit tests that invoke the role directly without
    // priorArtifact still work — both passes treat null as "no prior context".
    const architectArtifact = inv.priorArtifact ?? null;

    const runAnthropic = () => anthropicPass({
      llm: this.opts.anthropic, skills: this.opts.skills,
      userTurn: inv.userTurn, architectArtifact, graphSlice: inv.graphSlice,
      model: this.opts.anthropicModel ?? DEVELOPER_ANTHROPIC_MODEL,
      targetTemplate: this.opts.targetTemplate
    }).then((output): { provider: "anthropic"; status: "ok"; output: DeveloperOutput } => ({ provider: "anthropic", status: "ok", output }))
      .catch((err: Error): { provider: "anthropic"; status: "error"; error: Error } => ({ provider: "anthropic", status: "error", error: err }));

    const runGoogle = () => googlePass({
      llm: this.opts.google, skills: this.opts.skills,
      userTurn: inv.userTurn, architectArtifact, graphSlice: inv.graphSlice,
      model: this.opts.googleModel ?? DEVELOPER_GOOGLE_MODEL,
      targetTemplate: this.opts.targetTemplate
    }).then((output): { provider: "google"; status: "ok"; output: DeveloperOutput } => ({ provider: "google", status: "ok", output }))
      .catch((err: Error): { provider: "google"; status: "error"; error: Error } => ({ provider: "google", status: "error", error: err }));

    // parallel: both passes fire concurrently (best with distinct providers).
    // sequential: anthropic finishes before google starts (best with a single
    // local proxy that crashes under concurrent load — the user's setup).
    const [anthropicResult, googleResult] = this.opts.parallelMode === "sequential"
      ? [await runAnthropic(), await runGoogle()]
      : await Promise.all([runAnthropic(), runGoogle()]);

    if (anthropicResult.status === "ok") {
      events.push({ eventType: "developer.anthropic.completed", payload: { summary: anthropicResult.output.summary } });
    } else {
      events.push({ eventType: "developer.anthropic.failed", payload: { error: anthropicResult.error.message } });
    }
    if (googleResult.status === "ok") {
      events.push({ eventType: "developer.google.completed", payload: { summary: googleResult.output.summary } });
    } else {
      events.push({ eventType: "developer.google.failed", payload: { error: googleResult.error.message } });
    }

    let winner: DeveloperOutput;
    if (anthropicResult.status === "ok" && googleResult.status === "ok") {
      let vote;
      try {
        vote = await reviewerVote({
          llm: this.opts.reviewer,
          anthropicOutput: anthropicResult.output,
          googleOutput: googleResult.output,
          model: this.opts.reviewerModel ?? DEVELOPER_REVIEWER_MODEL
        });
        events.push({ eventType: "developer.reviewer.voted", payload: { winner: vote.winner, reasoning: vote.reasoning } });
      } catch (err) {
        // Reviewer failure → default to Anthropic per OQ4
        events.push({ eventType: "developer.reviewer.failed_defaulting_anthropic", payload: { error: (err as Error).message } });
        winner = anthropicResult.output;
        events.push({ eventType: "developer.completed", payload: { summary: winner.summary, picked: "anthropic-default" } });
        return { events, diff: { kind: "patch", body: winner.diff } };
      }
      winner = vote.winner === "anthropic" ? anthropicResult.output : googleResult.output;
    } else if (anthropicResult.status === "ok") {
      winner = anthropicResult.output;
      events.push({ eventType: "developer.walkover", payload: { picked: "anthropic", reason: "google-failed" } });
    } else if (googleResult.status === "ok") {
      winner = googleResult.output;
      events.push({ eventType: "developer.walkover", payload: { picked: "google", reason: "anthropic-failed" } });
    } else {
      // Surface the underlying provider errors on stderr so dev-server logs
      // show what actually failed. Without this, the only visible message is
      // the BothProvidersFailedError wrap which loses diagnostic info.
      console.error("[role-developer] anthropic error:", anthropicResult.error.message);
      console.error("[role-developer] google error:    ", googleResult.error.message);
      events.push({ eventType: "developer.both_failed", payload: { anthropicError: anthropicResult.error.message, googleError: googleResult.error.message } });
      throw new BothProvidersFailedError("Both Anthropic and Google providers failed", { causes: [anthropicResult.error, googleResult.error] });
    }

    events.push({ eventType: "developer.completed", payload: { summary: winner.summary } });
    return { events, diff: { kind: "patch", body: winner.diff } };
  }

  /** Single-pass focused refine. Uses only the Anthropic provider slot.
   *  No parallel pass, no reviewer vote — the scope is intentionally narrow
   *  (one element, one file) so a second opinion adds latency without value. */
  private async runFocusedRefine(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({ eventType: "developer.dispatch.started", payload: { ritualId: inv.ritualId } });

    const fr = inv.priorArtifact as {
      focusedRefine: true;
      targetFile: string;
      targetAtlasId: string;
      sourceSlice: string;
    };

    const userTurn = renderFocusedRefineUserTurn({
      instruction: inv.userTurn,
      targetFile: fr.targetFile,
      targetAtlasId: fr.targetAtlasId,
      sourceSlice: fr.sourceSlice
    });

    const messages: LLMMessage[] = [
      {
        role: "system",
        content: FOCUSED_REFINE_SYSTEM_PROMPT + "\n\nReturn only a unified diff in a ```diff fenced block. No other prose.",
        cache_control: { type: "ephemeral" }
      },
      { role: "user", content: userTurn }
    ];

    const model = this.opts.anthropicModel ?? DEVELOPER_ANTHROPIC_MODEL;
    const completion = await this.opts.anthropic.complete(messages, { model, maxTokens: 8_000 });

    // Extract the diff from the fenced ```diff block in the response.
    const raw = completion.content;
    const fenceMatch = /```diff\r?\n([\s\S]*?)```/.exec(raw);
    const diffBody = fenceMatch ? fenceMatch[1]! : raw;

    const summary = `Focused refine: ${fr.targetAtlasId} in ${fr.targetFile}`;
    events.push({ eventType: "developer.completed", payload: { summary, focusedRefine: true } });
    return { events, diff: { kind: "patch", body: diffBody } };
  }
}
