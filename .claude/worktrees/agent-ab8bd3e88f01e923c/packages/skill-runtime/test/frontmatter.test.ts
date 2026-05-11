import { describe, expect, it } from "vitest";
import { validateFrontmatter, parseFrontmatter } from "../src/frontmatter.js";

describe("validateFrontmatter", () => {
  it("accepts minimal valid frontmatter", () => {
    const result = validateFrontmatter({
      name: "brainstorm",
      description: "Explore requirements before building",
      activate_on: ["brainstorm", "what should I build"]
    });
    expect(result.name).toBe("brainstorm");
    expect(result.composes).toBeUndefined();
    expect(result.model_hint).toBeUndefined();
  });

  it("accepts full frontmatter with all optional fields", () => {
    const result = validateFrontmatter({
      name: "tdd-feature",
      description: "TDD a new feature end-to-end",
      activate_on: ["tdd", "write tests first"],
      composes: ["brainstorm"],
      model_hint: "claude-haiku-4-5",
      inputs: null,
      outputs: null
    });
    expect(result.composes).toEqual(["brainstorm"]);
    expect(result.model_hint).toBe("claude-haiku-4-5");
  });

  it("rejects missing name", () => {
    expect(() =>
      validateFrontmatter({ description: "x", activate_on: ["x"] })
    ).toThrow();
  });

  it("rejects missing description", () => {
    expect(() =>
      validateFrontmatter({ name: "x", activate_on: ["x"] })
    ).toThrow();
  });

  it("rejects missing activate_on", () => {
    expect(() =>
      validateFrontmatter({ name: "x", description: "x" })
    ).toThrow();
  });

  it("rejects empty activate_on array", () => {
    expect(() =>
      validateFrontmatter({ name: "x", description: "x", activate_on: [] })
    ).toThrow();
  });

  it("rejects name with spaces", () => {
    expect(() =>
      validateFrontmatter({ name: "my skill", description: "x", activate_on: ["x"] })
    ).toThrow();
  });
});

describe("parseFrontmatter", () => {
  const md = `---
name: brainstorm
description: Explore requirements
activate_on:
  - brainstorm
  - explore
---

# Brainstorm

Think about what you want to build.
`;

  it("extracts frontmatter object", () => {
    const { frontmatter } = parseFrontmatter(md);
    expect((frontmatter as Record<string, unknown>).name).toBe("brainstorm");
  });

  it("extracts body without the delimiters", () => {
    const { body } = parseFrontmatter(md);
    expect(body.trim()).toMatch(/^# Brainstorm/);
    expect(body).not.toContain("---");
  });

  it("returns empty-object frontmatter for a file with no frontmatter block", () => {
    const { frontmatter, body } = parseFrontmatter("# Just a body\n");
    expect(frontmatter).toEqual({});
    expect(body).toContain("# Just a body");
  });

  it("throws a descriptive error when YAML is malformed", () => {
    const bad = `---\nkey: [\n---\n# body\n`;
    expect(() => parseFrontmatter(bad)).toThrow(/YAML/i);
  });
});
