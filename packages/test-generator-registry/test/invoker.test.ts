import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@atlas/skill-runtime";
import type { Skill } from "@atlas/skill-runtime";
import { resolve } from "node:path";
import { TestGeneratorRegistry } from "../src/registry.js";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { invokeGenerator } from "../src/invoker.js";

const fixturesDir = resolve(__dirname, "fixtures/baselines");

const skill = (name: string, on: string, body = `# ${name}`): Skill => ({
  frontmatter: {
    name,
    description: "d",
    activate_on: [on]
  },
  body,
  sourcePath: `/fake/${name}.md`
});

describe("invokeGenerator — non-protected node", () => {
  it("returns source=generated and empty baselineAssertions", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-page", "node:page")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "p1", kind: "page" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("generated");
    expect(result.baselineAssertions).toEqual([]);
    expect(result.activationRecord.skillName).toBe("gen-test-page");
    expect(result.activationRecord.body).toContain("gen-test-page");
  });
});

describe("invokeGenerator — protected node", () => {
  it("AuthBoundary → source=baseline, body contains checklistItem + rationale", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-authboundary", "node:authboundary")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "ab1", kind: "authboundary" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("baseline");
    expect(result.baselineAssertions.length).toBe(2);
    expect(result.activationRecord.body).toContain("Human-authored baseline assertions");
    expect(result.activationRecord.body).toContain("GET /protected without session → 401");
    expect(result.activationRecord.body).toContain("_rationale:");
    expect(result.activationRecord.body).toContain("**mustEmitTest: true**");
  });

  it("Model with piiClassification=pii → uses pii-model baselines", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-model", "node:model")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "m1", kind: "model", piiClassification: "pii" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("baseline");
    expect(result.baselineAssertions[0]?.id).toBe("pii-not-in-logs");
  });

  it("Model with piiClassification=none → source=generated (not protected)", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-model", "node:model")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "m2", kind: "model", piiClassification: "none" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("generated");
    expect(result.baselineAssertions).toEqual([]);
  });
});
