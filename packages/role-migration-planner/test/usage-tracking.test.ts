import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { MigrationPlannerRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

const validPlan = {
  sourceTopologyRef: "workloadtopology:source",
  targetTopologyRef: "workloadtopology:target",
  stages: [
    { kind: "dual-run", name: "Dual run", description: "Mirror traffic", durationEstimateHours: 168, rollbackProcedure: "Tear down target", successCriteria: ["divergence < 1%"], risks: [] },
    { kind: "traffic-shift", name: "Shift", description: "5%→100%", durationEstimateHours: 4, rollbackProcedure: "Revert DNS", successCriteria: ["no SLO breach"], risks: [] },
    { kind: "verify", name: "Verify", description: "24hr soak", durationEstimateHours: 24, rollbackProcedure: "Roll back DNS", successCriteria: ["zero errors"], risks: [] },
    { kind: "cutover", name: "Cutover", description: "100% target", durationEstimateHours: 1, rollbackProcedure: "Revert DNS", successCriteria: ["all writes target"], risks: [] },
    { kind: "decommission", name: "Decom", description: "Tear down source", durationEstimateHours: 2, rollbackProcedure: "N/A", successCriteria: ["source destroyed"], risks: [] }
  ],
  totalEstimateHours: 199,
  prerequisites: ["dual-write infra"],
  operatorNotes: "Mind the gap."
};

describe("MigrationPlannerRole — usageTracker.record (Plan G.4 Task 3)", () => {
  it("records usage tagged roleId='migration-planner' after generateMigrationPlan", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_migration_plan", input: validPlan }],
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
      usage: { input_tokens: 600, output_tokens: 200 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const record = vi.fn();
    const role = new MigrationPlannerRole({ llm, skills });
    await role.run({
      ritualId: "r1",
      intent: "migration-planner",
      userTurn: JSON.stringify({ sourceTopologyRef: "workloadtopology:source", targetTopologyRef: "workloadtopology:target" }),
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      usageTracker: { record }
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 600, outputTokens: 200 },
      { roleId: "migration-planner" }
    );
  });
});
