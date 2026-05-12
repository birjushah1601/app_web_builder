import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { InspirationBrief, DesignIntent } from "@atlas/role-researcher";
import { DesignIntentSchema, InspirationBriefSchema } from "@atlas/role-researcher";
import { assembleProposal } from "./assemble-proposal.js";
import { DesignerFailedError } from "./errors.js";
import { DesignProposalSchema, type DesignProposal } from "./types.js";
import {
  CRITIQUE_SYSTEM_PROMPT,
  CRITIQUE_TOOL_SCHEMA,
  CritiqueSchema,
  type Critique
} from "./critique-prompt.js";
import {
  REVISE_SYSTEM_PROMPT,
  REVISED_PROPOSAL_TOOL_SCHEMA
} from "./revise-prompt.js";

export interface DesignerRoleOptions {
  llm: LLMProvider;
}

type DesignerEvents = RoleOutput["events"];

export class DesignerRole implements Role {
  readonly id = "designer";
  private readonly llm: LLMProvider;

  constructor(opts: DesignerRoleOptions) {
    this.llm = opts.llm;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: DesignerEvents = [];

    const designIntent = extractDesignIntent(inv.priorArtifact);
    if (!designIntent) {
      events.push({
        eventType: "designer.proposal.skipped",
        payload: { reason: "no designIntent in priorArtifact" }
      });
      return { events, diff: { kind: "none" } };
    }

    const brief = extractBrief(inv.priorArtifact);
    const architectArtifact = extractArchitectArtifact(inv.priorArtifact);

    events.push({
      eventType: "designer.proposal.started",
      payload: { ritualId: inv.ritualId, category: designIntent.category, hasBrief: brief !== null }
    });

    // ─── Pass 1: draft (always runs — extracted from old single-pass body) ───
    let draft: DesignProposal;
    try {
      draft = await this.draftProposal(designIntent, brief, architectArtifact);
    } catch (err) {
      const reason = err instanceof DesignerFailedError ? err.reason : "unknown";
      events.push({
        eventType: "designer.proposal.failed",
        payload: { error: (err as Error).message, reason }
      });
      throw err;
    }
    events.push({
      eventType: "designer.draft.completed",
      payload: { proposal: draft }
    });

    const critiqueOn = process.env.ATLAS_FF_DESIGNER_CRITIQUE === "true";
    if (!critiqueOn) {
      // Flag-off path — emit the draft as the final proposal. Today's behavior:
      // emits `designer.proposal.completed` AND `designer.proposal.emitted` so
      // both existing consumers and the new (flag-aware) ones see the final.
      events.push({
        eventType: "designer.proposal.completed",
        payload: { proposal: draft }
      });
      events.push({
        eventType: "designer.proposal.emitted",
        payload: { proposal: draft }
      });
      return { events, diff: { kind: "none" } };
    }

    // ─── Pass 2: critique ───
    events.push({ eventType: "designer.critique.started", payload: {} });
    let critique: Critique;
    try {
      critique = await this.critiqueDraft(draft, brief);
    } catch (err) {
      const reason = err instanceof DesignerFailedError ? err.reason : "unknown";
      events.push({
        eventType: "designer.proposal.failed",
        payload: { error: (err as Error).message, reason }
      });
      throw err;
    }
    events.push({ eventType: "designer.critique.completed", payload: { critique } });

    // ─── Pass 3: revise ───
    events.push({ eventType: "designer.revise.started", payload: {} });
    let finalProposal: DesignProposal;
    try {
      finalProposal = await this.reviseDraft(draft, critique);
    } catch (err) {
      const reason = err instanceof DesignerFailedError ? err.reason : "unknown";
      events.push({
        eventType: "designer.proposal.failed",
        payload: { error: (err as Error).message, reason }
      });
      throw err;
    }
    events.push({
      eventType: "designer.revise.completed",
      payload: { proposal: finalProposal }
    });
    events.push({
      eventType: "designer.proposal.completed",
      payload: { proposal: finalProposal }
    });
    events.push({
      eventType: "designer.proposal.emitted",
      payload: { proposal: finalProposal }
    });
    return { events, diff: { kind: "none" } };
  }

  private async draftProposal(
    designIntent: DesignIntent,
    brief: InspirationBrief | null,
    architectArtifact: unknown
  ): Promise<DesignProposal> {
    return assembleProposal({
      llm: this.llm,
      designIntent,
      brief,
      architectArtifact
    });
  }

  private async critiqueDraft(
    draft: DesignProposal,
    brief: InspirationBrief | null
  ): Promise<Critique> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: CRITIQUE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }
      },
      {
        role: "user",
        content: `Draft to critique:\n${JSON.stringify(draft, null, 2)}\n\nResearcher brief (if any):\n${JSON.stringify(brief, null, 2)}`
      }
    ];

    let result: { toolName: string; input: unknown };
    try {
      result = await (this.llm as unknown as {
        completeWithToolUse: (
          m: LLMMessage[],
          o: Record<string, unknown>
        ) => Promise<{ toolName: string; input: unknown }>;
      }).completeWithToolUse(messages, {
        model: process.env.ATLAS_LLM_DESIGNER_CRITIQUE_MODEL ?? "anthropic/claude-haiku-4.5",
        maxTokens: 1024,
        tools: [
          {
            name: "emit_critique",
            description: "Emit critique findings",
            input_schema: CRITIQUE_TOOL_SCHEMA
          }
        ],
        toolChoice: { type: "tool", name: "emit_critique" }
      });
    } catch (err) {
      throw new DesignerFailedError(`critique LLM call failed: ${(err as Error).message}`, {
        cause: err,
        reason: "llm-error"
      });
    }

    const parsed = CritiqueSchema.safeParse(result.input);
    if (!parsed.success) {
      throw new DesignerFailedError(`critique tool_use payload failed schema: ${parsed.error.message}`, {
        cause: parsed.error,
        reason: "schema-mismatch"
      });
    }
    return parsed.data;
  }

  private async reviseDraft(draft: DesignProposal, critique: Critique): Promise<DesignProposal> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: REVISE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }
      },
      {
        role: "user",
        content: `Draft:\n${JSON.stringify(draft, null, 2)}\n\nCritique:\n${JSON.stringify(critique, null, 2)}`
      }
    ];

    let result: { toolName: string; input: unknown };
    try {
      result = await (this.llm as unknown as {
        completeWithToolUse: (
          m: LLMMessage[],
          o: Record<string, unknown>
        ) => Promise<{ toolName: string; input: unknown }>;
      }).completeWithToolUse(messages, {
        model: process.env.ATLAS_LLM_DESIGNER_REVISE_MODEL ?? "anthropic/claude-sonnet-4.5",
        maxTokens: 4096,
        tools: [
          {
            name: "emit_revised_proposal",
            description: "Emit revised proposal",
            input_schema: REVISED_PROPOSAL_TOOL_SCHEMA
          }
        ],
        toolChoice: { type: "tool", name: "emit_revised_proposal" }
      });
    } catch (err) {
      throw new DesignerFailedError(`revise LLM call failed: ${(err as Error).message}`, {
        cause: err,
        reason: "llm-error"
      });
    }

    const parsed = DesignProposalSchema.safeParse(result.input);
    if (!parsed.success) {
      throw new DesignerFailedError(`revised proposal tool_use payload failed schema: ${parsed.error.message}`, {
        cause: parsed.error,
        reason: "schema-mismatch"
      });
    }
    return parsed.data;
  }
}

function extractDesignIntent(priorArtifact: unknown): DesignIntent | null {
  if (!priorArtifact || typeof priorArtifact !== "object") return null;
  const di = (priorArtifact as { designIntent?: unknown }).designIntent;
  const parsed = DesignIntentSchema.safeParse(di);
  return parsed.success ? parsed.data : null;
}

function extractBrief(priorArtifact: unknown): InspirationBrief | null {
  if (!priorArtifact || typeof priorArtifact !== "object") return null;
  const brief = (priorArtifact as { brief?: unknown }).brief;
  if (brief == null) return null;
  const parsed = InspirationBriefSchema.safeParse(brief);
  return parsed.success ? parsed.data : null;
}

function extractArchitectArtifact(priorArtifact: unknown): unknown {
  if (!priorArtifact || typeof priorArtifact !== "object") return {};
  return (priorArtifact as { architectArtifact?: unknown }).architectArtifact ?? {};
}
