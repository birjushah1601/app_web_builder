import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { MigrationPlannerRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("MigrationPlannerRole.run (passed)", () => {
  it("returns a plan event when LLM returns a valid 5-stage plan", async () => {
    const validPlan = {
      sourceTopologyRef: "workloadtopology:source",
      targetTopologyRef: "workloadtopology:target",
      stages: [
        {
          kind: "dual-run",
          name: "Dual run",
          description: "Mirror traffic",
          durationEstimateHours: 168,
          rollbackProcedure: "Tear down target",
          successCriteria: ["divergence < 1%"],
          risks: []
        },
        {
          kind: "traffic-shift",
          name: "Shift",
          description: "5%→100%",
          durationEstimateHours: 4,
          rollbackProcedure: "Revert DNS",
          successCriteria: ["no SLO breach"],
          risks: []
        },
        {
          kind: "verify",
          name: "Verify",
          description: "24hr soak",
          durationEstimateHours: 24,
          rollbackProcedure: "Roll back to source",
          successCriteria: ["zero divergence"],
          risks: []
        },
        {
          kind: "cutover",
          name: "Cutover",
          description: "Promote target",
          durationEstimateHours: 1,
          rollbackProcedure: "Reverse promotion within 24h",
          successCriteria: ["source has zero writes 24h"],
          risks: []
        },
        {
          kind: "decommission",
          name: "Decommission",
          description: "Tear down source",
          durationEstimateHours: 168,
          rollbackProcedure: "Restore from snapshot",
          successCriteria: ["source torn down"],
          risks: []
        }
      ],
      totalEstimateHours: 365,
      prerequisites: ["target provisioned"],
      operatorNotes: "page #infra"
    };
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu",
          name: "emit_migration_plan",
          input: validPlan
        }
      ],
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
      usage: { input_tokens: 200, output_tokens: 800 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new MigrationPlannerRole({ llm, skills });

    const out = await role.run({
      ritualId: "r-mig-1",
      intent: "migration-planner",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: JSON.stringify({
        sourceTopologyRef: "workloadtopology:source",
        targetTopologyRef: "workloadtopology:target"
      })
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("migration-planner.started");
    expect(types).toContain("migration-planner.plan-generated");
    expect(types).toContain("migration-planner.completed");
    expect(out.diff.kind).toBe("none");

    const completed = out.events.find((e) => e.eventType === "migration-planner.completed");
    const plan = (completed?.payload as { plan: { stages: Array<{ kind: string }> } }).plan;
    expect(plan.stages.length).toBe(5);
    expect(plan.stages[0]?.kind).toBe("dual-run");
    expect(plan.stages[4]?.kind).toBe("decommission");
  });
});
