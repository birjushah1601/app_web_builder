# Plan F — IaC + Deploy Artifact Kinds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new producer roles (`role-iac` + `role-deployer`) that emit typed `IacArtifact` (docker-compose + k8s manifests + service topology) and `DeployArtifact` (Argo CD Application + image-build references + smoke-test definitions). No runtime execution — that's Plan F.2.

**Architecture:** Reuses Plan E's `roleChain` hint to dispatch the new roles per artifactKind. The `IacArtifact` carries BOTH compose YAML (for local-run / sandbox preview) AND k8s manifests (for the production Knative + Argo CD + cert-manager target — the OSS-stack pivot's commitment). `DeployArtifact` references the iac's k8s manifests via a generated Argo CD `Application` manifest. OpenStack-specific cluster config lives in the future runtime adapter, NOT in the artifact contract.

**Tech Stack:** TypeScript pnpm monorepo, Zod 3.23, vitest, optional `docker compose config` for compose lint when available.

**Spec reference:** `docs/superpowers/specs/2026-05-29-plan-f-iac-deploy-design.md`

**Depends on:** Plans A + B + C + D + E merged. Branch off current `main` (`2e9b542`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/iac.ts` | IacArtifactSchema + registration |
| `packages/workflow-engine/src/artifact-contracts/deploy.ts` | DeployArtifactSchema + registration |
| `packages/workflow-engine/test/artifact-contracts/iac.test.ts` | Schema tests |
| `packages/workflow-engine/test/artifact-contracts/deploy.test.ts` | Schema tests |
| `packages/role-iac/` | New workspace package |
| `packages/role-iac/src/build-artifact.ts` | Pure: assemble IacArtifact from LLM JSON + upstream services |
| `packages/role-iac/src/role.ts` | IacRole — read upstream → LLM gen → optional lint → emit |
| `packages/role-iac/test/build-artifact.test.ts` | Helper tests |
| `packages/role-iac/test/role.test.ts` | Role tests |
| `packages/role-deployer/` | New workspace package |
| `packages/role-deployer/src/build-artifact.ts` | Pure: assemble DeployArtifact from iac + LLM JSON |
| `packages/role-deployer/src/role.ts` | DeployerRole — read upstream iac → LLM gen → emit |
| `packages/role-deployer/test/build-artifact.test.ts` | Helper tests |
| `packages/role-deployer/test/role.test.ts` | Role tests |
| `apps/atlas-web/components/canvas/renderers/IacCanvas.tsx` | Replaces IacStubCanvas |
| `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx` | Replaces DeployStubCanvas |
| `apps/atlas-web/test/components/canvas/renderers/IacCanvas.test.tsx` | Renderer tests |
| `apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx` | Renderer tests |
| `packages/workflow-engine/test/integration-iac-deploy-handoff.test.ts` | 3-node DAG (backend → iac → deploy) |

### Modified files
| File | Change |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/index.ts` | Side-effect imports of `./iac.js` + `./deploy.js` |
| `packages/workflow-engine/src/index.ts` | Re-export Iac + Deploy types |
| `packages/workflow-engine/src/engine.ts` | Extend `makeLaunchRitual`'s roleChain branch to map `"iac"` → `["iac"]` and `"deploy"` → `["deployer"]` |
| `apps/atlas-web/lib/engine/factory.ts` | Register IacRole + DeployerRole |
| `apps/atlas-web/components/canvas/register-renderers.tsx` | Register IacCanvas + DeployCanvas, drop stubs |

### Deleted files
| File | Reason |
|---|---|
| `apps/atlas-web/components/canvas/renderers/IacStubCanvas.tsx` | Replaced |
| `apps/atlas-web/components/canvas/renderers/DeployStubCanvas.tsx` | Replaced |

---

## Tasks

### Task 1: `IacArtifactSchema` + registration

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/iac.ts`
- Create: `packages/workflow-engine/test/artifact-contracts/iac.test.ts`
- Modify: `packages/workflow-engine/src/artifact-contracts/index.ts` — append `import "./iac.js";`
- Modify: `packages/workflow-engine/src/index.ts` — re-export `IacArtifactSchema`, `IacArtifact`

- [ ] **Step 1: Failing test** at `packages/workflow-engine/test/artifact-contracts/iac.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IacArtifactSchema } from "../../src/artifact-contracts/iac.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/registry.js";
import "../../src/artifact-contracts/iac.js";

describe("IacArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "iac" as const,
    compose: { file: "docker-compose.yml", content: "version: '3'\nservices: {}" },
    k8s: {
      manifests: [
        { file: "k8s/api.yaml", kind: "Service", name: "api", content: "apiVersion: v1\nkind: Service" }
      ]
    },
    services: [
      { name: "api", runtimeNodeId: "backend", artifactKind: "backend-rest-api", port: 8000, envContract: [] }
    ],
    imageRegistry: { url: "registry.atlas.local/projects", namespace: "proj-1" }
  };
  it("accepts a minimal valid artifact", () => {
    expect(IacArtifactSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects wrong kind literal", () => {
    expect(IacArtifactSchema.safeParse({ ...valid, kind: "deploy" }).success).toBe(false);
  });
  it("accepts services with optional port omitted", () => {
    const noPort = { ...valid, services: [{ ...valid.services[0], port: undefined }] };
    delete (noPort.services[0] as { port?: number }).port;
    expect(IacArtifactSchema.safeParse(noPort).success).toBe(true);
  });
  it("rejects services with negative port", () => {
    const bad = { ...valid, services: [{ ...valid.services[0], port: -1 }] };
    expect(IacArtifactSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts empty manifests array", () => {
    expect(IacArtifactSchema.safeParse({ ...valid, k8s: { manifests: [] } }).success).toBe(true);
  });
  it("is registered under 'iac' kind", () => {
    expect(ArtifactContractRegistry.has("iac")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test artifact-contracts/iac
```

- [ ] **Step 3: Implement** `packages/workflow-engine/src/artifact-contracts/iac.ts`:

```ts
import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

const K8sManifestSchema = z.object({
  file: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  content: z.string()
});

const ServiceSchema = z.object({
  name: z.string().min(1),
  runtimeNodeId: z.string().min(1),
  artifactKind: z.string().min(1),
  port: z.number().int().positive().optional(),
  envContract: z.array(z.object({
    name: z.string().min(1),
    required: z.boolean(),
    description: z.string().optional()
  }))
});

export const IacArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("iac"),
  compose: z.object({
    file: z.string().min(1),
    content: z.string()
  }),
  k8s: z.object({
    manifests: z.array(K8sManifestSchema)
  }),
  services: z.array(ServiceSchema),
  imageRegistry: z.object({
    url: z.string().min(1),
    namespace: z.string().min(1)
  })
});

export type IacArtifact = z.infer<typeof IacArtifactSchema>;
export type IacService = z.infer<typeof ServiceSchema>;
export type IacK8sManifest = z.infer<typeof K8sManifestSchema>;

ArtifactContractRegistry.register("iac", IacArtifactSchema);
```

- [ ] **Step 4: Side-effect import + re-export**

Append to `packages/workflow-engine/src/artifact-contracts/index.ts`:
```ts
import "./iac.js";
```

Append to `packages/workflow-engine/src/index.ts`:
```ts
export {
  IacArtifactSchema, type IacArtifact, type IacService, type IacK8sManifest
} from "./artifact-contracts/iac.js";
```

- [ ] **Step 5: Run, confirm green, commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine/src/artifact-contracts/iac.ts packages/workflow-engine/src/artifact-contracts/index.ts packages/workflow-engine/src/index.ts packages/workflow-engine/test/artifact-contracts/iac.test.ts
git commit -m "feat(workflow-engine): IacArtifact Zod schema + registry registration (Plan F Task 1)"
```

---

### Task 2: `DeployArtifactSchema` + registration

Mirror Task 1 with deploy's shape.

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/deploy.ts`
- Create: `packages/workflow-engine/test/artifact-contracts/deploy.test.ts`
- Modify: `index.ts` + main `index.ts` for side-effect import + re-export

- [ ] **Step 1: Failing test** with these cases:
  - Accepts minimal valid (target = "k8s", argoApplication + imageBuilds + smokeTests all non-empty)
  - Rejects wrong target literal (e.g. "compose")
  - Rejects smokeTest with expectStatus < 100 or > 599
  - Accepts smokeTest with optional `expectBodyContains`
  - Accepts empty imageBuilds (some workflows might have no buildable services)
  - Registered under "deploy" kind

- [ ] **Step 2: Implement** `packages/workflow-engine/src/artifact-contracts/deploy.ts`:

```ts
import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

const ArgoApplicationSchema = z.object({
  file: z.string().min(1),
  content: z.string(),
  name: z.string().min(1),
  repoUrl: z.string().min(1),
  path: z.string().min(1)
});

const ImageBuildSchema = z.object({
  serviceName: z.string().min(1),
  dockerfilePath: z.string().min(1),
  imageTag: z.string().min(1)
});

const SmokeTestSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["get", "post", "put", "patch", "delete", "head"]).optional(),
  expectStatus: z.number().int().min(100).max(599),
  expectBodyContains: z.string().optional()
});

export const DeployArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("deploy"),
  target: z.literal("k8s"),
  argoApplication: ArgoApplicationSchema,
  imageBuilds: z.array(ImageBuildSchema),
  smokeTests: z.array(SmokeTestSchema)
});

export type DeployArtifact = z.infer<typeof DeployArtifactSchema>;
export type DeployArgoApplication = z.infer<typeof ArgoApplicationSchema>;
export type DeployImageBuild = z.infer<typeof ImageBuildSchema>;
export type DeploySmokeTest = z.infer<typeof SmokeTestSchema>;

ArtifactContractRegistry.register("deploy", DeployArtifactSchema);
```

- [ ] **Step 3: Re-export + side-effect import**

Append to `packages/workflow-engine/src/artifact-contracts/index.ts`:
```ts
import "./deploy.js";
```

Append to main `packages/workflow-engine/src/index.ts`:
```ts
export {
  DeployArtifactSchema, type DeployArtifact, type DeployArgoApplication, type DeployImageBuild, type DeploySmokeTest
} from "./artifact-contracts/deploy.js";
```

- [ ] **Step 4: Run, commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine/src/artifact-contracts/deploy.ts packages/workflow-engine/src/artifact-contracts/index.ts packages/workflow-engine/src/index.ts packages/workflow-engine/test/artifact-contracts/deploy.test.ts
git commit -m "feat(workflow-engine): DeployArtifact Zod schema + registry registration (Plan F Task 2)"
```

---

### Task 3: `role-iac` package skeleton + `buildIacArtifact` pure helper

Mirror Plan E Task 2's bootstrap pattern.

**Files:**
- Create: `packages/role-iac/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (empty for now)
- Create: `packages/role-iac/src/build-artifact.ts`
- Create: `packages/role-iac/test/build-artifact.test.ts`

The helper takes the LLM's parsed output (already-generated YAML strings) + the upstream services list and assembles a validated IacArtifact. It's pure — no LLM call, no sandbox exec.

- [ ] **Step 1: Bootstrap package** mirroring `packages/role-tester/` (use `@atlas/role-tester` as the closest template). Run `pnpm install` from repo root.

- [ ] **Step 2: Failing test** at `packages/role-iac/test/build-artifact.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildIacArtifact } from "../src/build-artifact.js";

const COMPOSE = "version: '3'\nservices:\n  api:\n    image: registry.atlas.local/proj-1/api:latest";
const K8S_API = "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\nspec: {}";

describe("buildIacArtifact", () => {
  it("assembles a valid IacArtifact from LLM output", () => {
    const a = buildIacArtifact({
      composeYaml: COMPOSE,
      k8sManifests: [{ file: "k8s/api.yaml", kind: "Knative Service", name: "api", content: K8S_API }],
      services: [{ name: "api", runtimeNodeId: "backend", artifactKind: "backend-rest-api", port: 8000, envContract: [] }],
      imageRegistry: { url: "registry.atlas.local/projects", namespace: "proj-1" }
    });
    expect(a.kind).toBe("iac");
    expect(a.compose.content).toContain("api");
    expect(a.k8s.manifests).toHaveLength(1);
    expect(a.services[0]?.name).toBe("api");
  });

  it("threads envContract through verbatim", () => {
    const a = buildIacArtifact({
      composeYaml: COMPOSE,
      k8sManifests: [],
      services: [{
        name: "api", runtimeNodeId: "backend", artifactKind: "backend-rest-api", port: 8000,
        envContract: [{ name: "DATABASE_URL", required: true, description: "Postgres" }]
      }],
      imageRegistry: { url: "x", namespace: "y" }
    });
    expect(a.services[0]?.envContract).toHaveLength(1);
  });

  it("accepts services with no port", () => {
    const a = buildIacArtifact({
      composeYaml: COMPOSE,
      k8sManifests: [],
      services: [{ name: "worker", runtimeNodeId: "n", artifactKind: "x", envContract: [] }],
      imageRegistry: { url: "x", namespace: "y" }
    });
    expect(a.services[0]?.port).toBeUndefined();
  });
});
```

- [ ] **Step 3: Implement** `packages/role-iac/src/build-artifact.ts`:

```ts
import type { IacArtifact, IacService, IacK8sManifest } from "@atlas/workflow-engine";

export interface BuildIacArtifactInput {
  composeYaml: string;
  composeFile?: string;                    // defaults to "docker-compose.yml"
  k8sManifests: ReadonlyArray<IacK8sManifest>;
  services: ReadonlyArray<IacService>;
  imageRegistry: { url: string; namespace: string };
}

export function buildIacArtifact(input: BuildIacArtifactInput): IacArtifact {
  return {
    schemaVersion: "1",
    kind: "iac",
    compose: {
      file: input.composeFile ?? "docker-compose.yml",
      content: input.composeYaml
    },
    k8s: { manifests: [...input.k8sManifests] },
    services: [...input.services],
    imageRegistry: input.imageRegistry
  };
}
```

- [ ] **Step 4: Export from `src/index.ts`**

```ts
export { buildIacArtifact, type BuildIacArtifactInput } from "./build-artifact.js";
```

- [ ] **Step 5: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-iac test
cd F:/claude/ai_builder && pnpm -F @atlas/role-iac typecheck
git add packages/role-iac pnpm-lock.yaml
git commit -m "feat(role-iac): package skeleton + buildIacArtifact pure helper (Plan F Task 3)"
```

---

### Task 4: `IacRole`

Reads upstream runtime artifacts via `priorArtifact.upstream`, derives the services list, calls LLM to generate compose + k8s YAML, optionally lints, emits `ritual.artifact_emitted`.

**Files:**
- Create: `packages/role-iac/src/role.ts`
- Create: `packages/role-iac/test/role.test.ts`
- Modify: `packages/role-iac/src/index.ts` — export the role

- [ ] **Step 1: Failing test** with these cases:
  - Happy path: 2 upstream nodes (backend + frontend) → role emits `ritual.artifact_emitted` with a validated IacArtifact whose services list reflects both
  - Empty upstream → emits `iac.failed` with reason "no upstream runtime nodes to deploy"
  - LLM throws → emits `iac.failed` with the error
  - LLM returns invalid JSON → emits `iac.failed`
  - Lint command failure is tolerated (still emits the artifact when LLM output validated against schema)

- [ ] **Step 2: Implement** `packages/role-iac/src/role.ts`:

```ts
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { IacArtifactSchema, type IacService, type IacK8sManifest } from "@atlas/workflow-engine";
import { buildIacArtifact } from "./build-artifact.js";

export interface SandboxLike {
  exec(cmd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  write(path: string, contents: string): Promise<void>;
}

export interface IacRoleOptions {
  sandbox?: SandboxLike;
  /** LLM closure — returns { composeYaml, k8sManifests }. Injected for testability. */
  generateIac: (input: { services: ReadonlyArray<IacService>; ritualId: string }) =>
    Promise<{ composeYaml: string; k8sManifests: ReadonlyArray<IacK8sManifest> }>;
  imageRegistry?: { url: string; namespace: string };
}

export class IacRole implements Role {
  readonly id = "iac";
  constructor(private readonly opts: IacRoleOptions) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const upstream = (inv.priorArtifact as { upstream?: Record<string, unknown> } | undefined)?.upstream ?? {};
    const services: IacService[] = [];
    for (const [nodeId, raw] of Object.entries(upstream)) {
      if (!raw || typeof raw !== "object") continue;
      const a = raw as { kind?: string; previewUrl?: string; envContract?: unknown; routes?: Array<{ path: string }> };
      if (typeof a.kind !== "string") continue;
      if (a.kind !== "backend-rest-api" && a.kind !== "frontend-app" && a.kind !== "backend-graphql") continue;
      const envContract = Array.isArray(a.envContract)
        ? (a.envContract.filter((e: unknown): e is { name: string; required: boolean; description?: string } =>
            !!e && typeof e === "object" && typeof (e as { name: unknown }).name === "string"
              && typeof (e as { required: unknown }).required === "boolean") as IacService["envContract"])
        : [];
      const port = a.kind === "backend-rest-api" ? 8000 : a.kind === "backend-graphql" ? 4000 : 3000;
      services.push({
        name: nodeId.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
        runtimeNodeId: nodeId,
        artifactKind: a.kind,
        port,
        envContract
      });
    }

    if (services.length === 0) {
      events.push({ eventType: "iac.failed", payload: { reason: "no upstream runtime nodes to deploy" } });
      return { events, diff: { kind: "none" } };
    }

    let generated: { composeYaml: string; k8sManifests: ReadonlyArray<IacK8sManifest> };
    try {
      generated = await this.opts.generateIac({ services, ritualId: inv.ritualId });
    } catch (err) {
      events.push({ eventType: "iac.failed", payload: { reason: `LLM gen failed: ${err instanceof Error ? err.message : String(err)}` } });
      return { events, diff: { kind: "none" } };
    }

    // Optional lint — best-effort
    if (this.opts.sandbox) {
      try {
        await this.opts.sandbox.write("docker-compose.yml", generated.composeYaml);
        await this.opts.sandbox.exec("docker compose -f docker-compose.yml config");
        // Even if compose isn't installed, we don't fail — artifact still emits.
      } catch {
        // ignore — lint is advisory
      }
    }

    const artifact = buildIacArtifact({
      composeYaml: generated.composeYaml,
      k8sManifests: generated.k8sManifests,
      services,
      imageRegistry: this.opts.imageRegistry ?? { url: "registry.atlas.local/projects", namespace: "default" }
    });

    const parsed = IacArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({ eventType: "iac.failed", payload: { reason: `artifact failed schema validation: ${parsed.error.message}` } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "ritual.artifact_emitted", payload: { fromRole: "iac", artifact: parsed.data } });
    return { events, diff: { kind: "none" } };
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-iac test
git add packages/role-iac
git commit -m "feat(role-iac): IacRole — derive services, LLM-gen compose + k8s, emit (Plan F Task 4)"
```

---

### Task 5: `role-deployer` package + `buildDeployArtifact` pure helper

Same shape as Task 3 for deploy.

**Files:**
- Create: `packages/role-deployer/` package skeleton (mirror role-iac)
- Create: `packages/role-deployer/src/build-artifact.ts`
- Create: `packages/role-deployer/test/build-artifact.test.ts`

- [ ] **Step 1: Bootstrap package** mirroring role-iac.

- [ ] **Step 2: Failing test** at `packages/role-deployer/test/build-artifact.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDeployArtifact } from "../src/build-artifact.js";

describe("buildDeployArtifact", () => {
  it("assembles a valid DeployArtifact from LLM output", () => {
    const a = buildDeployArtifact({
      argoApplication: { file: "argo/app.yaml", name: "proj-1", repoUrl: "git@example.com:proj.git", path: "k8s/", content: "kind: Application" },
      imageBuilds: [{ serviceName: "api", dockerfilePath: "Dockerfile.api", imageTag: "registry/proj/api:sha-1" }],
      smokeTests: [{ url: "/health", expectStatus: 200 }]
    });
    expect(a.kind).toBe("deploy");
    expect(a.target).toBe("k8s");
    expect(a.argoApplication.name).toBe("proj-1");
    expect(a.imageBuilds).toHaveLength(1);
  });

  it("accepts empty imageBuilds and smokeTests", () => {
    const a = buildDeployArtifact({
      argoApplication: { file: "x", name: "x", repoUrl: "x", path: "x", content: "x" },
      imageBuilds: [],
      smokeTests: []
    });
    expect(a.imageBuilds).toEqual([]);
    expect(a.smokeTests).toEqual([]);
  });
});
```

- [ ] **Step 3: Implement** `packages/role-deployer/src/build-artifact.ts`:

```ts
import type { DeployArtifact, DeployArgoApplication, DeployImageBuild, DeploySmokeTest } from "@atlas/workflow-engine";

export interface BuildDeployArtifactInput {
  argoApplication: DeployArgoApplication;
  imageBuilds: ReadonlyArray<DeployImageBuild>;
  smokeTests: ReadonlyArray<DeploySmokeTest>;
}

export function buildDeployArtifact(input: BuildDeployArtifactInput): DeployArtifact {
  return {
    schemaVersion: "1",
    kind: "deploy",
    target: "k8s",
    argoApplication: { ...input.argoApplication },
    imageBuilds: [...input.imageBuilds],
    smokeTests: [...input.smokeTests]
  };
}
```

- [ ] **Step 4: Export + commit**

Append to `packages/role-deployer/src/index.ts`:
```ts
export { buildDeployArtifact, type BuildDeployArtifactInput } from "./build-artifact.js";
```

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-deployer test
git add packages/role-deployer pnpm-lock.yaml
git commit -m "feat(role-deployer): package skeleton + buildDeployArtifact pure helper (Plan F Task 5)"
```

---

### Task 6: `DeployerRole`

Reads `priorArtifact.upstream` for the iac artifact + any runtime artifacts (for previewUrl-based smoke tests). Calls LLM to derive argoApplication YAML + imageBuilds + smokeTests. Emits the artifact.

**Files:**
- Create: `packages/role-deployer/src/role.ts`
- Create: `packages/role-deployer/test/role.test.ts`
- Modify: `packages/role-deployer/src/index.ts` — export

- [ ] **Step 1: Failing test** with these cases:
  - Happy path: upstream contains an IacArtifact + a frontend-app artifact → emits ritual.artifact_emitted with valid DeployArtifact
  - Missing iac upstream → emits deployer.failed with reason "missing upstream iac artifact"
  - LLM throws → emits deployer.failed

- [ ] **Step 2: Implement** `packages/role-deployer/src/role.ts`:

```ts
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { DeployArtifactSchema, type DeployArgoApplication, type DeployImageBuild, type DeploySmokeTest, type IacArtifact } from "@atlas/workflow-engine";
import { buildDeployArtifact } from "./build-artifact.js";

export interface DeployerRoleOptions {
  /** LLM closure — returns argoApplication YAML, imageBuilds, smokeTests. */
  generateDeploy: (input: { iac: IacArtifact; ritualId: string }) =>
    Promise<{
      argoApplication: DeployArgoApplication;
      imageBuilds: ReadonlyArray<DeployImageBuild>;
      smokeTests: ReadonlyArray<DeploySmokeTest>;
    }>;
}

export class DeployerRole implements Role {
  readonly id = "deployer";
  constructor(private readonly opts: DeployerRoleOptions) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const upstream = (inv.priorArtifact as { upstream?: Record<string, unknown> } | undefined)?.upstream ?? {};
    let iac: IacArtifact | undefined;
    for (const raw of Object.values(upstream)) {
      if (raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "iac") {
        iac = raw as IacArtifact;
        break;
      }
    }

    if (!iac) {
      events.push({ eventType: "deployer.failed", payload: { reason: "missing upstream iac artifact" } });
      return { events, diff: { kind: "none" } };
    }

    let generated: { argoApplication: DeployArgoApplication; imageBuilds: ReadonlyArray<DeployImageBuild>; smokeTests: ReadonlyArray<DeploySmokeTest> };
    try {
      generated = await this.opts.generateDeploy({ iac, ritualId: inv.ritualId });
    } catch (err) {
      events.push({ eventType: "deployer.failed", payload: { reason: `LLM gen failed: ${err instanceof Error ? err.message : String(err)}` } });
      return { events, diff: { kind: "none" } };
    }

    const artifact = buildDeployArtifact(generated);
    const parsed = DeployArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({ eventType: "deployer.failed", payload: { reason: `artifact failed schema validation: ${parsed.error.message}` } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "ritual.artifact_emitted", payload: { fromRole: "deployer", artifact: parsed.data } });
    return { events, diff: { kind: "none" } };
  }
}
```

- [ ] **Step 3: Export + commit**

Append to `packages/role-deployer/src/index.ts`:
```ts
export { DeployerRole, type DeployerRoleOptions } from "./role.js";
```

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-deployer test
git add packages/role-deployer
git commit -m "feat(role-deployer): DeployerRole — read iac upstream, LLM-gen Argo + image + smoke, emit (Plan F Task 6)"
```

---

### Task 7: Wire IacRole + DeployerRole via roleChain in workflow-engine + atlas-web factory

**Files:**
- Modify: `packages/workflow-engine/src/engine.ts` — extend the roleChain branch
- Modify: `apps/atlas-web/lib/engine/factory.ts` — register both roles
- Create: `packages/workflow-engine/test/engine-launch-ritual-iac-deploy-rolechain.test.ts` — verify launchRitual routes correctly

- [ ] **Step 1: Failing test** that asserts launchRitual passes `roleChain: ["iac"]` for `iac` kind and `roleChain: ["deployer"]` for `deploy` kind.

(Mirror `engine-launch-ritual-tests-rolechain.test.ts` — copy/adapt.)

- [ ] **Step 2: Extend `makeLaunchRitual` in `packages/workflow-engine/src/engine.ts`**

Find the current logic that maps `node.artifactKind === "tests"` to `roleChain: ["tester"]`. Extend it:

```ts
const ROLE_CHAIN_BY_KIND: Record<string, string[] | undefined> = {
  tests: ["tester"],
  iac: ["iac"],
  deploy: ["deployer"]
};

// inside launchRitual closure:
const roleChain = ROLE_CHAIN_BY_KIND[node.artifactKind];
return this.opts.ritualEngine.start({
  userTurn: node.summary,
  editClass: "structural",
  projectId: run.projectId,
  userId: run.userId,
  priorArtifact,
  ...(roleChain ? { roleChain } : {})
});
```

- [ ] **Step 3: Register both roles in atlas-web factory**

Mirror Plan E Task 5's TestsRole registration block. The roles need a `generateIac` / `generateDeploy` LLM closure each — copy-paste-adapt the TestsRole's `generateTests` closure pattern; the prompts should ask for JSON output matching the helper input shapes.

For Plan F v1, MINIMAL prompts are OK — full prompt-engineering is a polish task. Example sketch for generateIac:

```ts
const prompt = [
  "Generate docker-compose.yml AND a list of k8s/Knative manifests for these services:",
  JSON.stringify(services, null, 2),
  "Respond with JSON: { composeYaml: string, k8sManifests: Array<{ file, kind, name, content }> }",
  "Use the image registry: " + imageRegistry.url + "/" + imageRegistry.namespace
].join("\n\n");
```

- [ ] **Step 4: Run + typecheck + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
git add packages/workflow-engine apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(workflow-engine,atlas-web): wire IacRole + DeployerRole via roleChain (Plan F Task 7)"
```

---

### Task 8: `IacCanvas` component

Read-only view of the IacArtifact: shows the compose YAML in a code block, lists k8s manifests, shows the services table.

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/IacCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/IacCanvas.test.tsx`

- [ ] **Step 1: Failing test** with these cases:
  - Renders compose YAML in a `<pre>` block with the artifact's content
  - Renders one row per service with name + kind + port
  - Renders one row per k8s manifest with file + kind + name
  - Empty-state when artifact undefined

- [ ] **Step 2: Implement** following Plan E's TestsCanvas + Plan D's BackendCanvas Tailwind vocabulary. Three vertically-stacked sections:
  - Services table (one row per service)
  - Compose section (collapsible header + `<pre>` showing artifact.compose.content)
  - K8s manifests table (file / kind / name; "view" toggles per-manifest YAML)

`data-testid` keys: `iac-canvas-empty`, `iac-services-row-{name}`, `iac-compose-content`, `iac-manifest-row-{name}`.

- [ ] **Step 3: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
cd F:/claude/ai_builder && pnpm --filter atlas-web test IacCanvas
git add apps/atlas-web/components/canvas/renderers/IacCanvas.tsx apps/atlas-web/test/components/canvas/renderers/IacCanvas.test.tsx
git commit -m "feat(atlas-web): IacCanvas — compose + k8s + topology read-only view (Plan F Task 8)"
```

---

### Task 9: `DeployCanvas` component

Read-only view of the DeployArtifact: Argo Application summary + per-service image-build list + smoke-test table.

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx`

- [ ] **Step 1: Failing test** with these cases:
  - Renders Argo app name + repo URL + path
  - Renders one row per imageBuild (service + Dockerfile + tag)
  - Renders one row per smokeTest (url + expected status + expected body)
  - "Execution lands in F.2" banner visible (caller-facing note)
  - Empty-state when artifact undefined

- [ ] **Step 2: Implement**

`data-testid` keys: `deploy-canvas-empty`, `deploy-argo-summary`, `deploy-image-row-{serviceName}`, `deploy-smoke-row-{url}`, `deploy-future-banner`.

- [ ] **Step 3: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
cd F:/claude/ai_builder && pnpm --filter atlas-web test DeployCanvas
git add apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx
git commit -m "feat(atlas-web): DeployCanvas — Argo + images + smoke read-only view (Plan F Task 9)"
```

---

### Task 10: Renderer swap (drop both stubs)

**Files:**
- Modify: `apps/atlas-web/components/canvas/register-renderers.tsx`
- Delete: `apps/atlas-web/components/canvas/renderers/IacStubCanvas.tsx`
- Delete: `apps/atlas-web/components/canvas/renderers/DeployStubCanvas.tsx`

- [ ] Swap both stub imports + registrations:
  - `topology` mode: IacStubCanvas → IacCanvas
  - `deploy-status` mode: DeployStubCanvas → DeployCanvas
- [ ] Delete both stub files.
- [ ] Run + commit:

```bash
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
cd F:/claude/ai_builder && pnpm --filter atlas-web test register-renderers
git add apps/atlas-web/components/canvas/register-renderers.tsx apps/atlas-web/components/canvas/renderers/IacStubCanvas.tsx apps/atlas-web/components/canvas/renderers/DeployStubCanvas.tsx
git commit -m "feat(atlas-web): swap Iac + Deploy stubs for real renderers (Plan F Task 10)"
```

---

### Task 11: Integration test — 3-node DAG (backend → iac → deploy)

**Files:**
- Create: `packages/workflow-engine/test/integration-iac-deploy-handoff.test.ts`

Mirror Plan E's `integration-tests-handoff.test.ts`. Two prongs:
1. iac node's persisted artifact has `kind === "iac"` with the emitted services list
2. deploy node's start() call captured `priorArtifact.upstream.<iacNodeId>.kind === "iac"` (proves the upstream merge works)

The fake `IRitualEngine.start()`:
- Empty upstream → backend ritual → emits a real `BackendArtifact` event
- Upstream has backend kind only → iac ritual → emits a real `IacArtifact` event
- Upstream has iac kind → deploy ritual → emits a real `DeployArtifact` event

Seed with `runRepo.insert` + `nodeRepo.insertMany` directly (skip the planner).

- [ ] **Step 1: Write the test** (copy + adapt the Plan E template)

- [ ] **Step 2: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test integration-iac-deploy-handoff
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine/test/integration-iac-deploy-handoff.test.ts
git commit -m "test(workflow-engine): end-to-end backend → iac → deploy typed handoff (Plan F Task 11)"
```

---

## Plan F — Self-review checklist

- [ ] Spec §"Per-kind shapes" → Tasks 1, 2
- [ ] Spec §"role-iac" → Tasks 3, 4
- [ ] Spec §"role-deployer" → Tasks 5, 6
- [ ] Spec §"roleChain wiring" → Task 7
- [ ] Spec §"Renderers" → Tasks 8, 9, 10
- [ ] Spec §"Out of scope" (no execution) → Honored — every role/canvas is producer-only

**Shippable result:** A workflow with backend + iac + deploy nodes runs end-to-end (producer-only). IacRole produces docker-compose + k8s manifests + service topology from upstream runtime artifacts. DeployerRole consumes iac + produces Argo CD Application + image-build references + smoke-test definitions. The user drills into either node and sees the rendered artifacts. Plan F.2 plugs in `kubectl`/`argocd` execution behind the same artifact contract.
