import { describe, it, expect } from "vitest";
import {
  getSandboxContextPrompt,
  listAvailableTemplates,
  DEFAULT_TEMPLATE_NAME
} from "../src/sandbox-context-registry.js";

describe("sandbox-context-registry", () => {
  it("returns the next-ts-v2 prompt by default", () => {
    const prompt = getSandboxContextPrompt(undefined);
    expect(prompt).toContain("Next.js 15");
    expect(prompt).toContain("shadcn/ui");
  });

  it("returns the next-ts-v2 prompt when explicitly named", () => {
    const prompt = getSandboxContextPrompt("atlas-next-ts-v2");
    expect(prompt).toContain("Next.js 15");
  });

  it("returns the fastapi prompt when targeted", () => {
    const prompt = getSandboxContextPrompt("atlas-fastapi");
    expect(prompt).toContain("FastAPI");
    expect(prompt).toContain("Pydantic");
    expect(prompt).not.toContain("Next.js");
  });

  it("falls back to default for unknown templates (graceful degrade)", () => {
    const prompt = getSandboxContextPrompt("atlas-vapor-rust-2050");
    expect(prompt).toContain("Next.js 15");
  });

  it("DEFAULT_TEMPLATE_NAME is 'atlas-next-ts-v2'", () => {
    expect(DEFAULT_TEMPLATE_NAME).toBe("atlas-next-ts-v2");
  });

  it("listAvailableTemplates returns at least both v1 templates", () => {
    const list = listAvailableTemplates();
    expect(list).toContain("atlas-next-ts-v2");
    expect(list).toContain("atlas-fastapi");
  });
});
