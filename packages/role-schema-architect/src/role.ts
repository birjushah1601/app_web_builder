import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { DesignIntent, InspirationBrief } from "@atlas/role-researcher";
import { DesignIntentSchema, InspirationBriefSchema } from "@atlas/role-researcher";
import { assembleProposal } from "./assemble-proposal.js";
import { SchemaArchitectFailedError } from "./errors.js";
import { SchemaProposalSchema, type SchemaProposal } from "./types.js";
import { CRITIQUE_SYSTEM_PROMPT, CRITIQUE_TOOL_SCHEMA, CritiqueSchema, type Critique } from "./critique-prompt.js";
import { REVISE_SYSTEM_PROMPT, REVISED_PROPOSAL_TOOL_SCHEMA } from "./revise-prompt.js";

export interface SchemaArchitectRoleOptions {
  llm: LLMProvider;
  critiqueModel?: string;
  reviseModel?: string;
}

type SchemaArchitectEvents = RoleOutput["events"];

export class SchemaArchitectRole implements Role {
  readonly id = "schema-architect";
  private readonly llm: LLMProvider;
  private readonly critiqueModel: string | undefined;
  private readonly reviseModel: string | undefined;

  constructor(opts: SchemaArchitectRoleOptions) {
    this.llm = opts.llm;
    this.critiqueModel = opts.critiqueModel;
    this.reviseModel = opts.reviseModel;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: SchemaArchitectEvents = [];

    const designIntent = extractDesignIntent(inv.priorArtifact);
    if (!designIntent) {
      events.push({ eventType: "schema_architect.proposal.skipped", payload: { reason: "no designIntent in priorArtifact" } });
      return { events, diff: { kind: "none" } };
    }

    const brief = extractBrief(inv.priorArtifact);
    const architectArtifact = extractArchitectArtifact(inv.priorArtifact);

    events.push({
      eventType: "schema_architect.proposal.started",
      payload: { ritualId: inv.ritualId }
    });

    let draft: SchemaProposal;
    try {
      draft = await assembleProposal({ llm: this.llm, designIntent, brief, architectArtifact });
    } catch (err) {
      const reason = err instanceof SchemaArchitectFailedError ? err.reason : "llm-error";
      events.push({ eventType: "schema_architect.proposal.failed", payload: { error: (err as Error).message, reason } });
      throw err;
    }

    const threePass = process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS === "true";
    if (!threePass) {
      events.push({ eventType: "schema_architect.proposal.emitted", payload: { proposal: draft } });
      events.push({ eventType: "schema_architect.proposal.completed", payload: { proposal: draft } });
      return { events, diff: { kind: "none" } };
    }

    // 3-pass branch — gated; default OFF
    events.push({ eventType: "schema_architect.critique.started", payload: {} });
    let critique: Critique;
    try {
      critique = await this.critique(draft);
    } catch (err) {
      const reason = err instanceof SchemaArchitectFailedError ? err.reason : "llm-error";
      events.push({ eventType: "schema_architect.proposal.failed", payload: { error: (err as Error).message, reason } });
      throw err;
    }
    events.push({ eventType: "schema_architect.critique.completed", payload: { critique } });

    events.push({ eventType: "schema_architect.revise.started", payload: {} });
    let final: SchemaProposal;
    try {
      final = await this.revise(draft, critique);
    } catch (err) {
      const reason = err instanceof SchemaArchitectFailedError ? err.reason : "llm-error";
      events.push({ eventType: "schema_architect.proposal.failed", payload: { error: (err as Error).message, reason } });
      throw err;
    }
    events.push({ eventType: "schema_architect.revise.completed", payload: { proposal: final } });

    events.push({ eventType: "schema_architect.proposal.emitted", payload: { proposal: final } });
    events.push({ eventType: "schema_architect.proposal.completed", payload: { proposal: final } });
    return { events, diff: { kind: "none" } };
  }

  private async critique(draft: SchemaProposal): Promise<Critique> {
    const messages: LLMMessage[] = [
      { role: "system", content: CRITIQUE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { role: "user", content: `Draft proposal:\n${JSON.stringify(draft, null, 2)}` }
    ];
    const result = await (this.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: this.critiqueModel ?? process.env.ATLAS_LLM_SCHEMA_CRITIQUE_MODEL ?? "anthropic/claude-haiku-4.5",
      maxTokens: 1024,
      tools: [{ name: "emit_critique", description: "Emit critique", input_schema: CRITIQUE_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_critique" }
    });
    const parsed = CritiqueSchema.safeParse(result.input);
    if (!parsed.success) throw new SchemaArchitectFailedError(`critique payload failed schema: ${parsed.error.message}`, { reason: "schema-mismatch", cause: parsed.error });
    return parsed.data;
  }

  private async revise(draft: SchemaProposal, critique: Critique): Promise<SchemaProposal> {
    const messages: LLMMessage[] = [
      { role: "system", content: REVISE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { role: "user", content: `Draft:\n${JSON.stringify(draft, null, 2)}\n\nCritique:\n${JSON.stringify(critique, null, 2)}` }
    ];
    const result = await (this.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: this.reviseModel ?? process.env.ATLAS_LLM_SCHEMA_REVISE_MODEL ?? "anthropic/claude-haiku-4.5",
      maxTokens: 8192,
      tools: [{ name: "emit_revised_schema_proposal", description: "Emit revised proposal", input_schema: REVISED_PROPOSAL_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_revised_schema_proposal" }
    });
    const parsed = SchemaProposalSchema.safeParse(result.input);
    if (!parsed.success) throw new SchemaArchitectFailedError(`revised proposal failed schema: ${parsed.error.message}`, { reason: "schema-mismatch", cause: parsed.error });
    return parsed.data;
  }
}

function extractDesignIntent(prior: unknown): DesignIntent | null {
  if (!prior || typeof prior !== "object") return null;
  const di = (prior as { designIntent?: unknown }).designIntent;
  const parsed = DesignIntentSchema.safeParse(di);
  return parsed.success ? parsed.data : null;
}

function extractBrief(prior: unknown): InspirationBrief | null {
  if (!prior || typeof prior !== "object") return null;
  const brief = (prior as { brief?: unknown }).brief;
  if (brief == null) return null;
  const parsed = InspirationBriefSchema.safeParse(brief);
  return parsed.success ? parsed.data : null;
}

function extractArchitectArtifact(prior: unknown): unknown {
  if (!prior || typeof prior !== "object") return {};
  return (prior as { architectArtifact?: unknown }).architectArtifact ?? {};
}
