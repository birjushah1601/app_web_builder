// apps/atlas-web/e2e/fixtures/spec-graph-seeds.ts
import { SpecGraphRepo } from "@atlas/spec-graph-data";
import type { SpecGraph } from "@atlas/spec-graph-schema";

/** Minimal valid Spec Graph for a fresh integration-test project. */
export function minimalSeed(projectId: string, name: string): SpecGraph {
  return {
    schemaVersion: "1.0.0",
    projectId,
    name,
    complianceClasses: ["baseline"],
    databaseProvider: {
      tier: "atlas-run",
      provider: "neon",
      region: "us-east-1",
      connectionStringRef: "env:DATABASE_URL",
    },
    templateDigest: "sha256:" + "0".repeat(64),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: {
      "page:home": {
        kind: "page",
        id: "page:home",
        path: "/",
        title: "Home",
        renderMode: "ssr",
        routeRef: "GET /",
      },
    },
    edges: [],
  };
}

export async function insertSeed(repo: SpecGraphRepo, seed: SpecGraph): Promise<void> {
  await repo.upsert(seed);
}

export async function deleteSeed(repo: SpecGraphRepo, projectId: string): Promise<void> {
  await repo.delete(projectId);
}
