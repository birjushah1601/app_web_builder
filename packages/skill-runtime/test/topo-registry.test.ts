import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/loader.js";
import { SkillRegistry } from "../src/registry.js";
import { CyclicDependencyError } from "../src/topo.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

describe("SkillRegistry composes resolution", () => {
  it("resolveComposeOrder returns dependency-first order for a valid chain", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR).filter((s) =>
      ["compose-a", "compose-b", "compose-c"].includes(s.frontmatter.name)
    );
    const reg = new SkillRegistry(skills);
    const order = reg.resolveComposeOrder("compose-a");
    expect(order.indexOf("compose-c")).toBeLessThan(order.indexOf("compose-b"));
    expect(order.indexOf("compose-b")).toBeLessThan(order.indexOf("compose-a"));
  });

  it("resolveComposeOrder for a leaf skill returns just that skill", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR).filter((s) =>
      s.frontmatter.name === "compose-c"
    );
    const reg = new SkillRegistry(skills);
    expect(reg.resolveComposeOrder("compose-c")).toEqual(["compose-c"]);
  });

  it("throws CyclicDependencyError for a cyclic composes graph", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR).filter((s) =>
      ["cycle-x", "cycle-y"].includes(s.frontmatter.name)
    );
    const reg = new SkillRegistry(skills);
    expect(() => reg.resolveComposeOrder("cycle-x")).toThrow(CyclicDependencyError);
  });
});
