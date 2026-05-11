import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { InspirationBrief, DesignIntent } from "@atlas/role-researcher";
import { DesignIntentSchema, InspirationBriefSchema } from "@atlas/role-researcher";
import { assembleProposal } from "./assemble-proposal.js";
import { DesignerFailedError } from "./errors.js";

export interface DesignerRoleOptions {
  llm: LLMProvider;
}

export class DesignerRole implements Role {
  readonly id = "designer";
  private readonly llm: LLMProvider;

  constructor(opts: DesignerRoleOptions) {
    this.llm = opts.llm;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];

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

    try {
      const proposal = await assembleProposal({
        llm: this.llm,
        designIntent,
        brief,
        architectArtifact
      });
      events.push({
        eventType: "designer.proposal.completed",
        payload: { proposal }
      });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      const reason = err instanceof DesignerFailedError ? err.reason : "unknown";
      events.push({
        eventType: "designer.proposal.failed",
        payload: { error: (err as Error).message, reason }
      });
      throw err;
    }
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
