import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { WorkflowPlannerRole } from "../src/role.js";
import { PLANNER_TRIAGE_MODEL } from "../src/triage.js";
import { PLANNER_SYNTH_MODEL } from "../src/synthesize-dag.js";

const BASE_INV = {
  ritualId: "wf-run-1",
  intent: "workflow-planner",
  graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
  userTurn: "build a SaaS platform with login, REST API, and a React frontend"
};

function makeProvider(triageOutput: unknown, dagOutput?: unknown) {
  const sdkCreate = dagOutput
    ? vi.fn()
        .mockResolvedValueOnce({
          content: [{ type: "tool_use", id: "t1", name: "emit_planner_triage", input: triageOutput }],
          model: PLANNER_TRIAGE_MODEL,
          stop_reason: "tool_use",
          usage: { input_tokens: 20, output_tokens: 10 }
        })
        .mockResolvedValueOnce({
          content: [{ type: "tool_use", id: "t2", name: "emit_dag", input: dagOutput }],
          model: PLANNER_SYNTH_MODEL,
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 300 }
        })
    : vi.fn().mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_planner_triage", input: triageOutput }],
        model: PLANNER_TRIAGE_MODEL,
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 }
      });

  const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
  return new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
}

describe("WorkflowPlannerRole.run — Task 8", () => {
  it("happy path: triage passes → synthesize → emits dag.emitted", async () => {
    const provider = makeProvider(
      { passed: true, questions: [] },
      {
        nodes: [
          { id: "api", artifactKind: "backend-rest-api", summary: "REST API", dependsOn: [], consumes: [] },
          { id: "ui", artifactKind: "frontend-app", summary: "React SPA", dependsOn: ["api"], consumes: ["api"] }
        ],
        dependencyProfile: {
          schemaVersion: "1",
          auth: { provider: "keycloak" },
          db: { provider: "postgres", connectionStringEnvVar: "DATABASE_URL" }
        },
        reasoning: "Standard web platform split"
      }
    );

    const role = new WorkflowPlannerRole({ llm: provider });
    const out = await role.run(BASE_INV);

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("workflow_planner.pass1.started");
    expect(types).toContain("workflow_planner.pass1.completed");
    expect(types).toContain("workflow_planner.pass2.started");
    expect(types).toContain("workflow_planner.pass2.completed");
    expect(types).toContain("workflow_planner.dag.emitted");

    const dagEvent = out.events.find((e) => e.eventType === "workflow_planner.dag.emitted");
    expect(dagEvent).toBeDefined();
    const payload = dagEvent!.payload as {
      nodes: Array<{ id: string; artifactKind: string; policy: unknown; status: string }>;
      dependencyProfile: { schemaVersion: string };
    };
    expect(payload.nodes).toHaveLength(2);
    expect(payload.nodes[0].id).toBe("api");
    expect(payload.nodes[0].artifactKind).toBe("backend-rest-api");
    // Engine-required fields attached by role.ts
    expect(payload.nodes[0].policy).toBeDefined();
    expect(payload.nodes[0].status).toBe("pending");
    expect(payload.dependencyProfile.schemaVersion).toBe("1");

    expect(out.diff.kind).toBe("none");
  });

  it("triage fails: emits needs_input events, does NOT call synthesize", async () => {
    const provider = makeProvider({
      passed: false,
      questions: [
        {
          question: "Should we use Stripe or Lago for billing?",
          reason: "Prompt mentions Stripe but OSS default is Lago",
          severity: "blocker",
          widgetKind: "single-select",
          options: ["Stripe", "Lago"]
        }
      ]
    });

    const role = new WorkflowPlannerRole({ llm: provider });
    const out = await role.run(BASE_INV);

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("workflow_planner.pass1.started");
    expect(types).toContain("workflow_planner.pass1.completed");
    expect(types).toContain("workflow_planner.triage.needs_input");
    expect(types).not.toContain("workflow_planner.pass2.started");
    expect(types).not.toContain("workflow_planner.dag.emitted");

    const needsInput = out.events.find((e) => e.eventType === "workflow_planner.triage.needs_input")!;
    expect(needsInput.payload.question).toContain("Stripe");
    expect(needsInput.payload.widgetKind).toBe("single-select");
    expect(needsInput.payload.options).toEqual(["Stripe", "Lago"]);
  });

  it("threads suggestedKinds from priorArtifact", async () => {
    const provider = makeProvider(
      { passed: true, questions: [] },
      {
        nodes: [
          { id: "fe", artifactKind: "frontend-app", summary: "Frontend", dependsOn: [], consumes: [] }
        ],
        dependencyProfile: { schemaVersion: "1" },
        reasoning: "single frontend"
      }
    );

    const role = new WorkflowPlannerRole({ llm: provider });
    const out = await role.run({
      ...BASE_INV,
      priorArtifact: { suggestedKinds: ["frontend-app"] }
    });

    const dagEvent = out.events.find((e) => e.eventType === "workflow_planner.dag.emitted");
    expect(dagEvent).toBeDefined();
    const payload = dagEvent!.payload as { nodes: Array<{ artifactKind: string }> };
    expect(payload.nodes[0].artifactKind).toBe("frontend-app");
  });

  it("role has id='workflow-planner' and no rubric", () => {
    const role = new WorkflowPlannerRole({ llm: null as never });
    expect(role.id).toBe("workflow-planner");
    expect(role.rubric).toBeUndefined();
  });
});
