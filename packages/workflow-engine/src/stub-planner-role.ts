import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";

/** Stub planner that returns a 1-node DAG with the requested artifactKind.
 *  The artifactKind is read from priorArtifact.suggestedKinds[0] (set by
 *  startWorkflow); defaults to "frontend-app". Used by Plan A integration
 *  tests; Plan B replaces with real LLM. */
export class StubWorkflowPlannerRole implements Role {
  readonly id = "workflow-planner";
  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const prior = inv.priorArtifact as { suggestedKinds?: string[] } | undefined;
    const kind = prior?.suggestedKinds?.[0] ?? "frontend-app";
    return {
      events: [
        {
          eventType: "workflow_planner.dag.emitted",
          payload: {
            nodes: [
              {
                id: "n1",
                artifactKind: kind,
                summary: `Build the ${kind}`,
                dependsOn: [],
                consumes: [],
                policy: { priority: 0, runMode: "active" }
              }
            ],
            dependencyProfile: { schemaVersion: "1" }
          }
        }
      ],
      diff: { kind: "none" }
    };
  }
}
