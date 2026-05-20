import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@atlas/skill-runtime";
import type { Skill } from "@atlas/skill-runtime";
import { TestGeneratorRegistry } from "../src/registry.js";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { DriftDetector, hashActivationBody } from "../src/drift.js";
import { resolve } from "node:path";

const fixturesDir = resolve(__dirname, "fixtures/baselines");

const skill = (name: string, on: string, body: string): Skill => ({
  frontmatter: {
    name,
    description: "d",
    activate_on: [on]
  },
  body,
  sourcePath: `/fake/${name}.md`
});

describe("DriftDetector", () => {
  it("reports zero drift when generator body hash matches pinned hash", async () => {
    const skillObj = skill("gen-test-page", "node:page", "canonical body");
    const skillReg = new SkillRegistry([skillObj]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "page-home", kind: "page" } as never;
    const graph = { nodes: { "page-home": node } } as never;

    // invokeGenerator calls skillRegistry.activate, which returns body from the skill
    // For non-protected node, activation body === skill body (trimmed).
    const expectedHash = hashActivationBody("canonical body");
    const calibration = {
      version: 1,
      entries: [
        {
          nodeId: "page-home",
          kind: "page",
          expectedActivationBodyHash: expectedHash,
          pinnedAt: "2026-04-21T00:00:00.000Z"
        }
      ]
    };

    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);

    expect(report.driftedCount).toBe(0);
    expect(report.totalCount).toBe(1);
    expect(report.entries[0]?.drifted).toBe(false);
  });

  it("reports drift when generator body changes", async () => {
    const skillObj = skill("gen-test-page", "node:page", "NEW BODY");
    const skillReg = new SkillRegistry([skillObj]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "page-home", kind: "page" } as never;
    const graph = { nodes: { "page-home": node } } as never;

    const calibration = {
      version: 1,
      entries: [
        {
          nodeId: "page-home",
          kind: "page",
          expectedActivationBodyHash: hashActivationBody("old body"),
          pinnedAt: "2026-04-21T00:00:00.000Z"
        }
      ]
    };

    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);

    expect(report.driftedCount).toBe(1);
    expect(report.entries[0]?.drifted).toBe(true);
    expect(report.entries[0]?.diff).toContain("hash mismatch");
  });
});

describe("DriftDetector edge cases", () => {
  it("reports drift if calibration references a node missing from graph", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-page", "node:page", "body")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(fixturesDir);
    const graph = { nodes: {} } as never;

    const calibration = {
      version: 1,
      entries: [
        {
          nodeId: "missing",
          kind: "page",
          expectedActivationBodyHash: "deadbeef",
          pinnedAt: "2026-04-21T00:00:00.000Z"
        }
      ]
    };

    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);
    expect(report.entries[0]?.diff).toContain("node missing from graph");
    expect(report.driftedCount).toBe(1);
  });
});
