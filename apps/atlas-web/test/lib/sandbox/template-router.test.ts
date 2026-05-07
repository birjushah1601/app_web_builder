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

  it("falls back to atlas-next-ts-v2 for v2-deferred kinds (with shouldFallback=true returned)", () => {
    expect(templateForArtifactKind("backend-graphql", { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
    expect(templateForArtifactKind("data-pipeline", { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
    expect(templateForArtifactKind("mobile-app", { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
    expect(templateForArtifactKind("cli-tool", { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
  });

  it("falls back to default for undefined artifactKind", () => {
    expect(templateForArtifactKind(undefined, { multiStackFlagOn: true })).toBe("atlas-next-ts-v2");
  });
});
