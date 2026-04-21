import { describe, it, expect } from "vitest";
import { languageFromPath } from "../../../lib/code/languageHint.js";

describe("languageFromPath", () => {
  it("returns typescript for .ts files", () => {
    expect(languageFromPath("src/index.ts")).toBe("typescript");
  });

  it("returns typescript for .tsx files", () => {
    expect(languageFromPath("components/Foo.tsx")).toBe("typescript");
  });

  it("returns javascript for .js files", () => {
    expect(languageFromPath("scripts/run.js")).toBe("javascript");
  });

  it("returns javascript for .jsx files", () => {
    expect(languageFromPath("App.jsx")).toBe("javascript");
  });

  it("returns json for .json files", () => {
    expect(languageFromPath("package.json")).toBe("json");
  });

  it("returns css for .css files", () => {
    expect(languageFromPath("styles/globals.css")).toBe("css");
  });

  it("returns markdown for .md files", () => {
    expect(languageFromPath("README.md")).toBe("markdown");
  });

  it("returns yaml for .yml files", () => {
    expect(languageFromPath(".github/ci.yml")).toBe("yaml");
  });

  it("returns yaml for .yaml files", () => {
    expect(languageFromPath("docker-compose.yaml")).toBe("yaml");
  });

  it("returns python for .py files", () => {
    expect(languageFromPath("main.py")).toBe("python");
  });

  it("returns sql for .sql files", () => {
    expect(languageFromPath("migrations/001.sql")).toBe("sql");
  });

  it("returns plaintext for unknown extensions", () => {
    expect(languageFromPath("Makefile")).toBe("plaintext");
    expect(languageFromPath("file.xyz")).toBe("plaintext");
  });
});
