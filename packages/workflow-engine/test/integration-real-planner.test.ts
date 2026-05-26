/**
 * Plan B Task 10 — Integration test with the REAL WorkflowPlannerRole + stub LLM.
 *
 * The real WorkflowPlannerRole makes 2 LLM calls (triage + synthesize). We wire
 * a stub LLM (AnthropicProvider backed by a vi.fn() mock SDK) that returns:
 *   - Call 1 (triage): { passed: true, questions: [] }
 *   - Call 2 (synthesize): 2-node DAG (api → ui)
 *
 * The IRitualEngine implementation runs the real role inline on start() and
 * stores the resulting events so getRitual() can return them synchronously.
 * This exercises WorkflowEngine.start() → awaitPlannerDag() → DAG insertion
 * → approvePlan() → scheduler → completed.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowEngine, type IRitualEngine } from "../src/engine.js";
import { createDatabase } from "../../spec-graph-data/src/client.js";
import { WorkflowRunRepo } from "../../spec-graph-data/src/repo/workflow-run.repo.js";
import { WorkflowNodeRepo } from "../../spec-graph-data/src/repo/workflow-node.repo.js";
import { WorkflowPlannerRole } from "../../role-workflow-planner/src/role.js";

// ---------------------------------------------------------------------------
// DB Setup (same project row as integration.test.ts)
// ---------------------------------------------------------------------------

const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://atlas:atlas@localhost:5440/atlas_dev";

const db = createDatabase(DB_URL, { max: 3 });
const { pool } = db;

const TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000098";
const TEST_USER = "user-real-planner-test";

async function truncateWorkflowTables(): Promise<void> {
  await pool.query(
    "TRUNCATE workflow_runs, workflow_nodes, workflow_node_checkpoints, workflow_usage RESTART IDENTITY CASCADE"
  );
  const { withProjectContext } = await import("../../spec-graph-data/src/tenant.js");
  try {
    await withProjectContext(pool, TEST_PROJECT_ID, async (client) => {
      await client.query(
        `INSERT INTO spec_graphs (project_id, schema_version, graph_data, created_at, updated_at)
         VALUES ($1, 1, '{}', NOW(), NOW())
         ON CONFLICT (project_id) DO NOTHING`,
        [TEST_PROJECT_ID]
      );
      await client.query(
        `INSERT INTO projects (project_id, user_id, name, created_at, updated_at)
         VALUES ($1, $2, 'real-planner-test', NOW(), NOW())
         ON CONFLICT (project_id) DO NOTHING`,
        [TEST_PROJECT_ID, TEST_USER]
      );
    });
  } catch (err) {
    console.warn("[real-planner-test] FK setup warning:", (err as Error).message);
  }
}

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// Stub LLM factory
// The real WorkflowPlannerRole makes 2 sequential completeWithToolUse calls:
//   1. plannerTriage  → expects { passed, questions } tool output
//   2. synthesizeDag  → expects { nodes, dependencyProfile, reasoning } tool output
//
// We implement a minimal LLMProvider stub (no prom-client, no Anthropic SDK)
// that counts calls and returns the correct canned output for each.
// ---------------------------------------------------------------------------

// The role casts llm through `unknown` and calls .completeWithToolUse().
// We build a minimal stub object with just that method — no prom-client or SDK needed.
function makeStubLlm(dagNodes: Array<{
  id: string;
  artifactKind: string;
  summary: string;
  dependsOn: string[];
  consumes: string[];
}>) {
  let callCount = 0;

  const triageOutput = { passed: true, questions: [] };
  const dagOutput = {
    nodes: dagNodes,
    dependencyProfile: {
      schemaVersion: "1",
      auth: { provider: "keycloak" },
      db: { provider: "postgres", connectionStringEnvVar: "DATABASE_URL" }
    },
    reasoning: "Standard SaaS split — backend + frontend"
  };

  return {
    name: "stub",
    async completeWithToolUse(_messages: unknown, _options: unknown) {
      callCount++;
      if (callCount === 1) return { toolName: "emit_planner_triage", input: triageOutput };
      return { toolName: "emit_dag", input: dagOutput };
    },
    complete: async () => { throw new Error("stub: complete not used"); },
    stream: async function* () { throw new Error("stub: stream not used"); }
  } as unknown as import("../../llm-provider/src/provider.js").LLMProvider;
}

// ---------------------------------------------------------------------------
// Real-planner IRitualEngine
// Runs the real WorkflowPlannerRole inline on start(), stores events for getRitual().
// ---------------------------------------------------------------------------

function makeRealPlannerRitualEngine(dagNodes: Array<{
  id: string;
  artifactKind: string;
  summary: string;
  dependsOn: string[];
  consumes: string[];
}>): IRitualEngine {
  let counter = 0;
  const snapshots = new Map<string, {
    state: string;
    roleEvents: Array<{ eventType: string; payload: unknown }>;
  }>();

  return {
    async start(input) {
      const ritualId = `real-planner-ritual-${++counter}`;
      const llm = makeStubLlm(dagNodes);
      const role = new WorkflowPlannerRole({ llm });

      // Build a minimal RoleInvocation
      const inv = {
        ritualId,
        intent: "workflow-planner",
        graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
        userTurn: (input as { prompt?: string }).prompt ?? "Build a full-stack SaaS"
      };

      const output = await role.run(inv);
      snapshots.set(ritualId, {
        state: "completed",
        roleEvents: output.events.map((e) => ({ eventType: e.eventType, payload: e.payload }))
      });
      return ritualId;
    },
    async getRitual(ritualId) {
      return snapshots.get(ritualId);
    },
    async abort(_ritualId, _reason) {
      // no-op
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Plan B Task 10: Real WorkflowPlannerRole integration", () => {
  beforeEach(async () => {
    await truncateWorkflowTables();
  });

  it("engine.start() with real planner → awaiting_approval, 2 nodes inserted, dag.emitted event present", async () => {
    const dagNodes = [
      { id: "api", artifactKind: "backend-rest-api", summary: "REST API", dependsOn: [], consumes: [] },
      { id: "ui", artifactKind: "frontend-app", summary: "React SPA", dependsOn: ["api"], consumes: ["api"] }
    ];

    const runRepo = new WorkflowRunRepo(pool);
    const nodeRepo = new WorkflowNodeRepo(pool);
    const ritualEngine = makeRealPlannerRitualEngine(dagNodes);
    const engine = new WorkflowEngine({ runRepo, nodeRepo, ritualEngine });

    // start() → real planner runs 2 LLM calls (triage + synthesize) → DAG inserted → awaiting_approval
    const runId = await engine.start({
      projectId: TEST_PROJECT_ID,
      userId: TEST_USER,
      prompt: "Build me a full-stack SaaS with login, API, and React frontend"
    });

    // Verify: run in awaiting_approval
    const run = await runRepo.findById(runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe("awaiting_approval");

    // Verify: 2 nodes inserted, both pending
    const nodes = await nodeRepo.findByRunId(runId);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.status === "pending")).toBe(true);

    // Verify: node IDs match what the real planner emitted
    const nodeIds = nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual(["api", "ui"]);
  });

  it("approve after real-planner start → scheduler runs → workflow completed", async () => {
    const dagNodes = [
      { id: "backend", artifactKind: "backend-rest-api", summary: "Backend API", dependsOn: [], consumes: [] },
      { id: "frontend", artifactKind: "frontend-app", summary: "Frontend SPA", dependsOn: ["backend"], consumes: ["backend"] }
    ];

    const runRepo = new WorkflowRunRepo(pool);
    const nodeRepo = new WorkflowNodeRepo(pool);
    const ritualEngine = makeRealPlannerRitualEngine(dagNodes);
    const engine = new WorkflowEngine({ runRepo, nodeRepo, ritualEngine });

    const runId = await engine.start({
      projectId: TEST_PROJECT_ID,
      userId: TEST_USER,
      prompt: "Build me a full-stack SaaS"
    });

    // Approve + run scheduler
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    const run = await runRepo.findById(runId);
    expect(run!.status).toBe("completed");

    const nodes = await nodeRepo.findByRunId(runId);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.status === "done")).toBe(true);
  });

  it("planner emits workflow_planner.dag.emitted event with correct node shape", async () => {
    const dagNodes = [
      { id: "svc", artifactKind: "backend-rest-api", summary: "Service", dependsOn: [], consumes: [] }
    ];

    const llm = makeStubLlm(dagNodes);
    const role = new WorkflowPlannerRole({ llm });

    const output = await role.run({
      ritualId: "test-ritual-x",
      intent: "workflow-planner",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "Build a backend service"
    });

    // Verify event sequence
    const types = output.events.map((e) => e.eventType);
    expect(types).toContain("workflow_planner.pass1.started");
    expect(types).toContain("workflow_planner.pass1.completed");
    expect(types).toContain("workflow_planner.pass2.started");
    expect(types).toContain("workflow_planner.pass2.completed");
    expect(types).toContain("workflow_planner.dag.emitted");

    // Verify dag.emitted payload shape (engine reads nodes + dependencyProfile)
    const dagEvent = output.events.find((e) => e.eventType === "workflow_planner.dag.emitted")!;
    const payload = dagEvent.payload as {
      nodes: Array<{ id: string; artifactKind: string; policy: unknown; status: string }>;
      dependencyProfile: { schemaVersion: string };
    };
    expect(payload.nodes).toHaveLength(1);
    expect(payload.nodes[0].id).toBe("svc");
    expect(payload.nodes[0].artifactKind).toBe("backend-rest-api");
    // Engine-required fields must be present
    expect(payload.nodes[0].policy).toBeDefined();
    expect(payload.nodes[0].status).toBe("pending");
    expect(payload.dependencyProfile.schemaVersion).toBe("1");
  });
});
