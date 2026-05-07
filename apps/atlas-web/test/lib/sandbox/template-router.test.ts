import { describe, it, expect } from "vitest";
import { templateForArtifactKind } from "@/lib/sandbox/template-router";

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

  it("routes backend-graphql to atlas-graphql-yoga when flag ON", () => {
    expect(templateForArtifactKind("backend-graphql", { multiStackFlagOn: true })).toBe("atlas-graphql-yoga");
  });

  it("routes data-pipeline to atlas-dlt-python when flag ON", () => {
    expect(templateForArtifactKind("data-pipeline", { multiStackFlagOn: true })).toBe("atlas-dlt-python");
  });

  it("routes mobile-app to atlas-expo-rn when flag ON", () => {
    expect(templateForArtifactKind("mobile-app", { multiStackFlagOn: true })).toBe("atlas-expo-rn");
  });

  it("routes cli-tool to atlas-bun-cli when flag ON", () => {
    expect(templateForArtifactKind("cli-tool", { multiStackFlagOn: true })).toBe("atlas-bun-cli");
  });

  it("falls back to default for undefined artifactKind", () => {
    expect(templateForArtifactKind(undefined, { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
  });
});
