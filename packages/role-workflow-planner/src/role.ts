import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { plannerTriage, PLANNER_TRIAGE_MODEL } from "./triage.js";
import { synthesizeDag, PLANNER_SYNTH_MODEL } from "./synthesize-dag.js";

export interface WorkflowPlannerRoleOptions {
  llm: LLMProvider;
  triageModel?: string;
  synthModel?: string;
}

export class WorkflowPlannerRole implements Role {
  readonly id = "workflow-planner";
  // No rubric in v1 — conductor eval gate sees undefined and skips.
  readonly rubric?: never;

  private readonly llm: LLMProvider;
  private readonly triageModel: string;
  private readonly synthModel: string;

  constructor(opts: WorkflowPlannerRoleOptions) {
    this.llm = opts.llm;
    this.triageModel = opts.triageModel ?? PLANNER_TRIAGE_MODEL;
    this.synthModel = opts.synthModel ?? PLANNER_SYNTH_MODEL;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];

    // Read suggestedKinds threaded via engine.start → priorArtifact
    const prior = inv.priorArtifact as { suggestedKinds?: string[] } | undefined;
    const suggestedKinds = prior?.suggestedKinds ?? [];

    // Pass 1 — triage
    events.push({
      eventType: "workflow_planner.pass1.started",
      payload: { ritualId: inv.ritualId }
    });

    let triageReport;
    try {
      triageReport = await plannerTriage({
        userTurn: inv.userTurn,
        suggestedKinds,
        llm: this.llm,
        triageModel: this.triageModel
      });
    } catch (err) {
      events.push({
        eventType: "workflow_planner.pass1.failed",
        payload: { error: (err as Error).message }
      });
      throw err;
    }

    events.push({
      eventType: "workflow_planner.pass1.completed",
      payload: { passed: triageReport.passed }
    });

    if (!triageReport.passed) {
      // Emit one needs_input event per blocker question — same shape as
      // architect.triage.needs_input so the engine-side canvas-pause kind
      // can handle both roles identically.
      for (const q of triageReport.questions.filter((x) => x.severity === "blocker")) {
        events.push({
          eventType: "workflow_planner.triage.needs_input",
          payload: {
            question: q.question,
            reason: q.reason,
            ...(q.widgetKind !== undefined ? { widgetKind: q.widgetKind } : {}),
            ...(q.options !== undefined ? { options: q.options } : {})
          }
        });
      }
      return { events, diff: { kind: "none" } };
    }

    // Pass 2 — DAG synthesis
    events.push({
      eventType: "workflow_planner.pass2.started",
      payload: {}
    });

    let dagOutput;
    try {
      dagOutput = await synthesizeDag({
        userTurn: inv.userTurn,
        triageReport,
        suggestedKinds,
        llm: this.llm,
        synthModel: this.synthModel
      });
    } catch (err) {
      events.push({
        eventType: "workflow_planner.pass2.failed",
        payload: { error: (err as Error).message }
      });
      throw err;
    }

    events.push({
      eventType: "workflow_planner.pass2.completed",
      payload: { nodeCount: dagOutput.nodes.length }
    });

    // The engine-consumed event — contract matches StubWorkflowPlannerRole.
    // WorkflowEngine.start() reads workflow_planner.dag.emitted to extract nodes + dependencyProfile.
    events.push({
      eventType: "workflow_planner.dag.emitted",
      payload: {
        nodes: dagOutput.nodes.map((n) => ({
          id: n.id,
          artifactKind: n.artifactKind,
          summary: n.summary,
          dependsOn: n.dependsOn,
          consumes: n.consumes,
          // Engine-required fields defaulted here; engine may override.
          policy: { priority: 0, runMode: "active" },
          status: "pending"
        })),
        dependencyProfile: dagOutput.dependencyProfile,
        reasoning: dagOutput.reasoning
      }
    });

    return { events, diff: { kind: "none" } };
  }
}
