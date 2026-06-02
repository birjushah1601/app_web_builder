import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { WorkflowPlannerRole } from "../src/role.js";
import { PLANNER_TRIAGE_MODEL } from "../src/triage.js";
import { PLANNER_SYNTH_MODEL } from "../src/synthesize-dag.js";

const BASE_INV = {
  ritualId: "wf-1",
  intent: "workflow-planner",
  graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
  userTurn: "build a SaaS platform with REST API and React frontend"
};

describe("WorkflowPlannerRole — usageTracker.record (Plan G.4 Task 3)", () => {
  it("records both triage + DAG-synth usage tagged roleId='workflow-planner'", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_planner_triage", input: { passed: true, questions: [] } }],
        model: PLANNER_TRIAGE_MODEL, stop_reason: "tool_use",
        usage: { input_tokens: 40, output_tokens: 12 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_dag",
          input: {
            nodes: [
              { id: "api", artifactKind: "backend-rest-api", summary: "REST API", dependsOn: [], consumes: [] }
            ],
            dependencyProfile: { schemaVersion: "1", auth: { provider: "keycloak" }, db: { provider: "postgres", connectionStringEnvVar: "DATABASE_URL" } },
            reasoning: "Single API"
          } }],
        model: PLANNER_SYNTH_MODEL, stop_reason: "tool_use",
        usage: { input_tokens: 400, output_tokens: 250 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const record = vi.fn();
    const role = new WorkflowPlannerRole({ llm });
    await role.run({ ...BASE_INV, usageTracker: { record } });

    expect(record).toHaveBeenCalledTimes(2);
    for (const call of record.mock.calls) {
      const opts = call[3] as { roleId?: string } | undefined;
      expect(opts?.roleId).toBe("workflow-planner");
    }
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 40, outputTokens: 12 },
      { roleId: "workflow-planner" }
    );
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 400, outputTokens: 250 },
      { roleId: "workflow-planner" }
    );
  });
});
