import { describe, it, expect } from "vitest";
import { MigrationPlanSchema, MigrationStageSchema, type MigrationPlan } from "../src/types.js";

const validStage = (kind: string, hours: number) => ({
  kind,
  name: `${kind} stage`,
  description: "desc",
  durationEstimateHours: hours,
  rollbackProcedure: "rollback",
  successCriteria: ["criterion 1"],
  risks: []
});

const validPlan: MigrationPlan = {
  sourceTopologyRef: "workloadtopology:source",
  targetTopologyRef: "workloadtopology:target",
  stages: [
    validStage("dual-run", 168),
    validStage("traffic-shift", 4),
    validStage("verify", 24),
    validStage("cutover", 1),
    validStage("decommission", 168)
  ],
  totalEstimateHours: 365,
  prerequisites: ["target provisioned"],
  operatorNotes: "page #infra on each stage transition"
};

describe("MigrationPlanSchema", () => {
  it("accepts a valid 5-stage plan in correct order", () => {
    expect(MigrationPlanSchema.safeParse(validPlan).success).toBe(true);
  });

  it("rejects wrong stage order", () => {
    const bad = {
      ...validPlan,
      stages: [
        validStage("traffic-shift", 4),
        validStage("dual-run", 168),
        validStage("verify", 24),
        validStage("cutover", 1),
        validStage("decommission", 168)
      ]
    };
    expect(MigrationPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects fewer than 5 stages", () => {
    const bad = { ...validPlan, stages: validPlan.stages.slice(0, 4) };
    expect(MigrationPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects more than 5 stages", () => {
    const bad = { ...validPlan, stages: [...validPlan.stages, validStage("decommission", 1)] };
    expect(MigrationPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects totalEstimateHours that doesn't equal sum of stage durations", () => {
    const bad = { ...validPlan, totalEstimateHours: 999 };
    const result = MigrationPlanSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("totalEstimateHours");
    }
  });

  it("rejects empty prerequisites", () => {
    const bad = { ...validPlan, prerequisites: [] };
    expect(MigrationPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("MigrationStage requires non-empty successCriteria", () => {
    expect(
      MigrationStageSchema.safeParse({ ...validStage("dual-run", 1), successCriteria: [] }).success
    ).toBe(false);
  });
});
