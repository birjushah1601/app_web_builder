import { describe, it, expect } from "vitest";
import { templateForArtifactKind, portForTemplate } from "@/lib/sandbox/template-router";

describe("templateForArtifactKind", () => {
  it("returns atlas-next-ts-v2 when multi-stack flag is OFF (regardless of artifactKind)", () => {
    expect(templateForArtifactKind("frontend-app", { multiStackFlagOn: false })).toBe("atlas-next-ts-v2");
    expect(templateForArtifactKind("backend-rest-api", { multiStackFlagOn: false })).toBe("atlas-next-ts-v2");
    expect(templateForArtifactKind("mobile-app", { multiStackFlagOn: false })).toBe("atlas-next-ts-v2");
  });

  it("routes frontend-app to atlas-next-ts-v2 when flag ON", () => {
    expect(templateForArtifactKind("frontend-app", { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
  });

  it("routes backend-rest-api to atlas-fastapi when flag ON", () => {
    expect(templateForArtifactKind("backend-rest-api", { multiStackFlagOn: true })).toBe("atlas-fastapi");
  });

  it("routes data-pipeline to atlas-dlt-python when flag ON", () => {
    expect(templateForArtifactKind("data-pipeline", { multiStackFlagOn: true })).toBe("atlas-dlt-python");
  });

  it("routes backend-graphql to atlas-graphql-yoga when flag ON (port-3001 fix)", () => {
    expect(templateForArtifactKind("backend-graphql", { multiStackFlagOn: true })).toBe("atlas-graphql-yoga");
  });

  it("routes cli-tool to atlas-bun-cli when flag ON (port-3001 fix)", () => {
    expect(templateForArtifactKind("cli-tool", { multiStackFlagOn: true })).toBe("atlas-bun-cli");
  });

  it("routes mobile-app back to next-ts-v2 fallback (atlas-expo-rn template build incompat with E2B start_cmd validation; restore once published)", () => {
    expect(templateForArtifactKind("mobile-app", { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
  });

  it("falls back to default for undefined artifactKind", () => {
    expect(templateForArtifactKind(undefined, { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
  });
});

describe("portForTemplate", () => {
  it("returns 3001 for the Bun trio (Bun.serve EADDRINUSEs on :3000 against e2bdev base)", () => {
    expect(portForTemplate("atlas-bun-cli")).toBe(3001);
    expect(portForTemplate("atlas-graphql-yoga")).toBe(3001);
    expect(portForTemplate("atlas-hono-bun")).toBe(3001);
  });

  it("returns 3000 for the Next/Python/Expo templates", () => {
    expect(portForTemplate("atlas-next-ts")).toBe(3000);
    expect(portForTemplate("atlas-next-ts-v2")).toBe(3000);
    expect(portForTemplate("atlas-fastapi")).toBe(3000);
    expect(portForTemplate("atlas-dlt-python")).toBe(3000);
    expect(portForTemplate("atlas-expo-rn")).toBe(3000);
  });

  it("returns undefined for unknown templates so the factory can apply its own defaults", () => {
    expect(portForTemplate("some-byo-raw-id-3kj4h")).toBeUndefined();
    expect(portForTemplate("atlas-not-a-real-template")).toBeUndefined();
  });
});
