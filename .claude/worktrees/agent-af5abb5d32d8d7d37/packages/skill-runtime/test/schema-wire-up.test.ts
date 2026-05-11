import { z } from "zod";
import { describe, expect, it } from "vitest";
import { nodeRegistry, edgeRegistry } from "@atlas/spec-graph-schema";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

describe("spec-graph-schema registry wire-up (OQ7)", () => {
  it("nodeRegistry is importable from @atlas/spec-graph-schema", () => {
    expect(nodeRegistry).toBeDefined();
    expect(nodeRegistry.page).toBeDefined();
    expect(nodeRegistry.component).toBeDefined();
  });

  it("edgeRegistry is importable from @atlas/spec-graph-schema", () => {
    expect(edgeRegistry).toBeDefined();
    expect(edgeRegistry.renders).toBeDefined();
  });

  it("a skill whose inputs schema references nodeRegistry.page parses valid page-shaped data", () => {
    // Use pageSchema as the inputs validator for a fixture skill
    const pageSchema = nodeRegistry.page;
    const skill: Skill = {
      frontmatter: {
        name: "gen-test-page",
        description: "Generate tests for a page node",
        activate_on: ["gen-test-page"],
        inputs: pageSchema
      },
      body: "# Gen Test Page",
      sourcePath: "/virtual/gen-test-page.md"
    };
    const reg = new SkillRegistry([skill]);

    // A valid minimal page node matching the actual PageSchema
    const validPage = {
      kind: "page",
      id: "page:home",
      path: "/home",
      title: "Home",
      renderMode: "ssr",
      authRequired: false
    };

    const record = reg.activate("gen-test-page", validPage);
    expect(record.skillName).toBe("gen-test-page");
    expect((record.validatedInputs as { kind: string }).kind).toBe("page");
  });

  it("rejects an invalid page node with a SkillInputValidationError", async () => {
    const { SkillInputValidationError } = await import("../src/registry.js");
    const pageSchema = nodeRegistry.page;
    const skill: Skill = {
      frontmatter: {
        name: "gen-test-page",
        description: "x",
        activate_on: ["x"],
        inputs: pageSchema
      },
      body: "",
      sourcePath: "/virtual/gen-test-page.md"
    };
    const reg = new SkillRegistry([skill]);

    expect(() => reg.activate("gen-test-page", { kind: "page" /* missing required fields */ }))
      .toThrow(SkillInputValidationError);
  });
});
