import { describe, it, expect } from "vitest";
import {
  GateLayerSchema,
  GateResultSchema,
  scheduleGates,
  runSyncGates,
  InMemoryAsyncQueue,
  AsyncGateWorker,
  RollbackArm,
  executeRollback,
  ResolutionFlow
} from "../src/index.js";

describe("gate-scheduler public API", () => {
  it("exports GateLayerSchema", () => {
    expect(GateLayerSchema.parse("L1")).toBe("L1");
  });

  it("exports GateResultSchema", () => {
    expect(GateResultSchema.parse({ layer: "L2", status: "passed", summary: "ok" })).toBeDefined();
  });

  it("exports scheduleGates", () => {
    expect(typeof scheduleGates).toBe("function");
  });

  it("exports runSyncGates", () => {
    expect(typeof runSyncGates).toBe("function");
  });

  it("exports InMemoryAsyncQueue", () => {
    expect(new InMemoryAsyncQueue()).toBeDefined();
  });

  it("exports AsyncGateWorker", () => {
    expect(typeof AsyncGateWorker).toBe("function");
  });

  it("exports RollbackArm + executeRollback", () => {
    const arm = new RollbackArm("sha", "reason");
    expect(arm.executed).toBe(false);
    expect(typeof executeRollback).toBe("function");
  });

  it("exports ResolutionFlow", () => {
    const flow = new ResolutionFlow({ maxRetries: 3 });
    expect(flow.attempts).toBe(0);
  });
});
