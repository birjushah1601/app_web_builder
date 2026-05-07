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

  it("listAvailableTemplates returns all 7 v1 templates", () => {
    const list = listAvailableTemplates();
    expect(list).toContain("atlas-next-ts-v2");
    expect(list).toContain("atlas-fastapi");
    expect(list).toContain("atlas-hono-bun");
    expect(list).toContain("atlas-graphql-yoga");
    expect(list).toContain("atlas-expo-rn");
    expect(list).toContain("atlas-dlt-python");
    expect(list).toContain("atlas-bun-cli");
  });

  it("returns hono-bun prompt when targeted", () => {
    const prompt = getSandboxContextPrompt("atlas-hono-bun");
    expect(prompt).toMatch(/Hono/);
    expect(prompt).not.toContain("Next.js 15");
  });

  it("returns graphql-yoga prompt when targeted", () => {
    const prompt = getSandboxContextPrompt("atlas-graphql-yoga");
    expect(prompt).toMatch(/GraphQL|Yoga|Pothos/);
  });

  it("returns expo-rn prompt when targeted", () => {
    const prompt = getSandboxContextPrompt("atlas-expo-rn");
    expect(prompt).toMatch(/Expo|React Native|NativeWind/);
  });

  it("returns dlt-python prompt when targeted", () => {
    const prompt = getSandboxContextPrompt("atlas-dlt-python");
    expect(prompt).toMatch(/dlt|DuckDB|dbt/);
  });

  it("returns bun-cli prompt when targeted", () => {
    const prompt = getSandboxContextPrompt("atlas-bun-cli");
    expect(prompt).toMatch(/Commander|ink|Bun/);
  });
});
