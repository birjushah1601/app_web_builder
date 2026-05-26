// test/scheduler.test.ts
import { describe, it, expect } from "vitest";
import { WorkflowScheduler, type SchedulerDeps } from "../src/scheduler.js";
import { chain, fanOut, diamond } from "./fixtures/dags.js";
import type { WorkflowRunSnapshot } from "../src/types.js";

function makeRun(
  nodes: WorkflowRunSnapshot["nodes"],
  concurrencyCap?: number
): WorkflowRunSnapshot {
  return {
    id: "00000000-0000-0000-0000-00000000aaaa",
    projectId: "00000000-0000-0000-0000-00000000bbbb",
    userId: "u1",
    prompt: "test",
    status: "running",
    nodes,
    edges: [],
    dependencyProfile: { schemaVersion: "1" },
    concurrencyCap,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function mockDeps(
  opts: { failures?: Set<string> } = {}
): SchedulerDeps & { ritualsLaunched: string[]; finalStatus: () => string | undefined } {
  const launched: string[] = [];
  let finalStatus: string | undefined;
  return {
    launchRitual: async (node) => {
      launched.push(node.id);
      return `r-${node.id}`;
    },
    awaitRitual: async (ritualId) => {
      const nodeId = ritualId.replace("r-", "");
      if (opts.failures?.has(nodeId)) return { kind: "failed", error: "test failure" };
      return {
        kind: "done",
        artifact: { schemaVersion: "1", kind: "test", payload: { id: nodeId } },
        artifactKind: "test"
      };
    },
    persistNodeState: async () => {},
    persistWorkflowStatus: async (s) => {
      finalStatus = s;
    },
    ritualsLaunched: launched,
    finalStatus: () => finalStatus
  } as any;
}

describe("WorkflowScheduler", () => {
  it("runs a chain end-to-end in order", async () => {
    const run = makeRun(chain());
    const deps = mockDeps();
    await new WorkflowScheduler(run, deps).execute();
    expect(deps.ritualsLaunched).toEqual(["a", "b", "c"]);
    expect(deps.finalStatus()).toBe("completed");
    expect(run.nodes.every((n) => n.status === "done")).toBe(true);
  });

  it("blocks dependents when a node fails; sibling continues", async () => {
    const run = makeRun(diamond());
    const deps = mockDeps({ failures: new Set(["b"]) });
    await new WorkflowScheduler(run, deps).execute();
    expect(run.nodes.find((n) => n.id === "a")!.status).toBe("done");
    expect(run.nodes.find((n) => n.id === "b")!.status).toBe("failed");
    expect(run.nodes.find((n) => n.id === "c")!.status).toBe("done");
    expect(run.nodes.find((n) => n.id === "d")!.status).toBe("blocked");
    expect(deps.finalStatus()).toBe("escalated");
  });

  it("runs fan-out nodes in parallel", async () => {
    const run = makeRun(fanOut());
    const deps = mockDeps();
    await new WorkflowScheduler(run, deps).execute();
    expect(deps.ritualsLaunched.slice(0, 1)).toEqual(["a"]);
    expect(deps.ritualsLaunched.slice(1).sort()).toEqual(["b", "c"]);
    expect(deps.finalStatus()).toBe("completed");
  });

  it("respects concurrency cap of 1 (sequential execution)", async () => {
    // With cap=1, even fan-out nodes must run one at a time.
    // Track the max simultaneously "running" count by wrapping launchRitual/awaitRitual.
    const nodes = fanOut();
    const run = makeRun(nodes, 1);

    let concurrent = 0;
    let maxConcurrent = 0;
    const launched: string[] = [];
    let finalStatus: string | undefined;

    const deps: SchedulerDeps & { ritualsLaunched: string[]; finalStatus: () => string | undefined } = {
      launchRitual: async (node) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        launched.push(node.id);
        return `r-${node.id}`;
      },
      awaitRitual: async (ritualId) => {
        // Yield the microtask queue so truly-concurrent launches would register
        await Promise.resolve();
        concurrent--;
        const nodeId = ritualId.replace("r-", "");
        return {
          kind: "done",
          artifact: { schemaVersion: "1", kind: "test", payload: { id: nodeId } },
          artifactKind: "test"
        };
      },
      persistNodeState: async () => {},
      persistWorkflowStatus: async (s) => { finalStatus = s; },
      ritualsLaunched: launched,
      finalStatus: () => finalStatus
    } as any;

    await new WorkflowScheduler(run, deps).execute();

    expect(maxConcurrent).toBe(1);
    expect(deps.finalStatus()).toBe("completed");
    // a must come first; b and c in some order
    expect(launched[0]).toBe("a");
    expect(launched.slice(1).sort()).toEqual(["b", "c"]);
  });
});
