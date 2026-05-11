import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { anthropicPass, DEVELOPER_ANTHROPIC_MODEL } from "./anthropic-pass.js";
import { googlePass, DEVELOPER_GOOGLE_MODEL } from "./google-pass.js";
import { reviewerVote, DEVELOPER_REVIEWER_MODEL } from "./reviewer-vote.js";
import { BothProvidersFailedError } from "./errors.js";
import type { DeveloperOutput } from "./types.js";

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
}

export class DeveloperRole implements Role {
  readonly id = "developer";
  private readonly opts: DeveloperRoleOptions;
  constructor(opts: DeveloperRoleOptions) { this.opts = opts; }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
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
      model: this.opts.anthropicModel ?? DEVELOPER_ANTHROPIC_MODEL
    }).then((output): { provider: "anthropic"; status: "ok"; output: DeveloperOutput } => ({ provider: "anthropic", status: "ok", output }))
      .catch((err: Error): { provider: "anthropic"; status: "error"; error: Error } => ({ provider: "anthropic", status: "error", error: err }));

    const runGoogle = () => googlePass({
      llm: this.opts.google, skills: this.opts.skills,
      userTurn: inv.userTurn, architectArtifact, graphSlice: inv.graphSlice,
      model: this.opts.googleModel ?? DEVELOPER_GOOGLE_MODEL
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
}
