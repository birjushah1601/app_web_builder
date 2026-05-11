import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { generateMigrationPlan, MIGRATION_PLANNER_MODEL } from "./plan-generator.js";

export interface MigrationPlannerRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class MigrationPlannerRole implements Role {
  readonly id = "migration-planner";
  private readonly opts: MigrationPlannerRoleOptions;

  constructor(opts: MigrationPlannerRoleOptions) {
    this.opts = opts;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({
      eventType: "migration-planner.started",
      payload: { ritualId: inv.ritualId }
    });

    // The userTurn for this role is expected to be JSON: { sourceTopologyRef, targetTopologyRef }
    let parsed: { sourceTopologyRef: string; targetTopologyRef: string };
    try {
      parsed = JSON.parse(inv.userTurn);
      if (
        typeof parsed.sourceTopologyRef !== "string" ||
        typeof parsed.targetTopologyRef !== "string"
      ) {
        throw new Error("userTurn must be JSON with sourceTopologyRef + targetTopologyRef strings");
      }
    } catch (err) {
      events.push({
        eventType: "migration-planner.errored",
        payload: { error: `userTurn parse: ${(err as Error).message}` }
      });
      throw err;
    }

    try {
      const plan = await generateMigrationPlan({
        llm: this.opts.llm,
        skills: this.opts.skills,
        sourceTopologyRef: parsed.sourceTopologyRef,
        targetTopologyRef: parsed.targetTopologyRef,
        graphSlice: inv.graphSlice,
        model: this.opts.model ?? MIGRATION_PLANNER_MODEL
      });
      events.push({
        eventType: "migration-planner.plan-generated",
        payload: {
          stageCount: plan.stages.length,
          totalEstimateHours: plan.totalEstimateHours,
          plan
        }
      });
      events.push({
        eventType: "migration-planner.completed",
        payload: { ritualId: inv.ritualId, plan }
      });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      events.push({
        eventType: "migration-planner.errored",
        payload: { error: (err as Error).message }
      });
      throw err;
    }
  }
}
