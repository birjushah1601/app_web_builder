import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSkillsFromDir, SkillRegistry } from "@atlas/skill-runtime";
import { TestGeneratorRegistry } from "../src/registry.js";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { invokeGenerator } from "../src/invoker.js";

const testGenDir = resolve(__dirname, "../../skill-library/skills/test-generators");
const baselinesDir = resolve(__dirname, "fixtures/baselines");

describe("integration: real skill-library", () => {
  it("indexes all 14 gen-test-* skills by node kind", () => {
    const skills = loadSkillsFromDir(testGenDir);
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);

    const kinds = reg.kinds().sort();
    expect(kinds.length).toBe(14);
    expect(kinds).toContain("page");
    expect(kinds).toContain("authboundary");
    expect(kinds).toContain("compliance");
  });

  it("invokes real gen-test-authboundary against a protected node → source=baseline", async () => {
    const skills = loadSkillsFromDir(testGenDir);
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(baselinesDir);

    const node = { id: "ab1", kind: "authboundary" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines });

    expect(result.emittedTestSource).toBe("baseline");
    expect(result.activationRecord.body).toMatch(/Human-authored baseline assertions/);
    expect(result.activationRecord.body).toMatch(/I13/);
  });
});
