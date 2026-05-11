# @atlas/deploy-orchestrator

Provider-abstract deploy orchestrator for Atlas Run. Per ADR-001 §1, Atlas does not use Vercel — it ships its own orchestration over Argo CD + Knative + cert-manager + Cloudflare.

## Flow

`deploy(request)` runs four steps in order:

1. **Branch DB** — calls `branching.ensureBranch(projectId, branchId)`. If the schema was just created, runs `migrate` to replay drizzle migrations against it.
2. **Manifest emit** — produces three YAML docs: a Knative `Service` (workload), an Argo CD `Application` (GitOps reconciler), a cert-manager `Certificate` (TLS via Cloudflare DNS-01).
3. **Apply** — `kubernetes.apply` for each manifest, then `cloudflare.upsertDnsRecord` for the FQDN.
4. **Reconcile** — polls `kubernetes.argoApplicationHealth` until `Healthy` or `Degraded`. On `Degraded`, deletes every applied manifest + DNS and throws `DeployError`.

## Provider seams

- `KubernetesClient` — `apply`, `delete`, `argoApplicationHealth`. The package ships `InMemoryKubernetesClient` for tests; production wraps `@kubernetes/client-node` (deferred — D10).
- `CloudflareClient` — `upsertDnsRecord`, `deleteDnsRecord`. Same pattern; production wraps the `cloudflare` SDK (deferred — D10).
- `BranchingPort` — implemented by `@atlas/postgres-branching`'s `PgBranchingAdapter` directly.
- `MigratePort` — implemented as `(input) => replayMigrationsToSchema({ pool, schemaName: input.schemaName, migrationsDir })`.

## Environment

| Var | Required | Description |
|---|---|---|
| `ATLAS_MANIFEST_REPO_URL` | Yes | Argo CD watches this Git repo for manifests |
| `ATLAS_CLUSTER_ISSUER` | Yes | cert-manager ClusterIssuer name (e.g., `letsencrypt-cloudflare-dns01`) |
| `ATLAS_INGRESS_TARGET` | Yes | CNAME target for Cloudflare records (e.g., `k8s-ingress.atlas.app`) |
| `ATLAS_GLITCHTIP_DSN_TEMPLATE` | No | If set, deploy injects `SENTRY_DSN` into Knative env so user apps emit exceptions to GlitchTip |

## GlitchTip injection

When `glitchTipDsnFor(projectId)` returns a string, the Knative Service env gains `SENTRY_DSN=<dsn>`. Apps deployed via Atlas Run get exception capture against your GlitchTip instance with no SDK lock-in (the Sentry SDK speaks the same protocol). Per ADR-001 §4.

## Cluster prerequisites

The chart at `deploy/atlas-helm/` provisions: Argo CD, Knative Serving, cert-manager + Cloudflare ClusterIssuer, the `atlas-projects` namespace, and the `atlas-platform` Argo project. Bootstrap order is documented in `deploy/atlas-helm/README.md`.
