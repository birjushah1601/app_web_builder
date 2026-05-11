# Codegen Upgrade — Atlas IaC Generation Service

> Audit + redesign of `cloud_migration/backend/app/services/codegen/` for the combined Atlas ecosystem.
>
> Last updated: 2026-04-18
> Companion to: `docs/ECOSYSTEM_VISION.md`, `docs/PRD_v3.md`
> Source reviewed: [`cloud_migration` @ main](https://github.com/birjushah1601/cloud_migration/tree/main/backend/app/services/codegen) — three files, `__init__.py` + `terraform_generator.py` + `terraform_templates.py`

---

## 1. What's There Today

Three files. ~500 LOC total.

- `terraform_generator.py` — `TerraformGenerator` class. `generate_from_plan()` orchestrates provider/variables/network/compute/storage/security module emission. `CodeModule` + `GeneratedCode` dataclasses hold outputs. Hardcoded AWS→OpenStack resource type mapping.
- `terraform_templates.py` — `TerraformTemplateEngine`. Every `.tf` file assembled by `lines.append(f"...")` string concatenation. Methods for `compute_instance`, `network`, `router`, `security_group`, `volume`, `floating_ip`. All emit **`openstack_*_v2`** resources only.

---

## 2. What's Wrong (honest audit)

| # | Issue | Impact |
|---|-------|--------|
| 1 | **String-concat HCL emitter.** Every `.tf` line is an f-string. No templating engine, no AST, no escaping for quotes/heredocs/multi-line user_data. | Fragile. One unescaped quote in a variable value = broken plan. Hard to unit-test. |
| 2 | **OpenStack-only.** Despite `ARCHITECTURE.md` claiming AWS/Azure/GCP support, the templates emit *only* `openstack_compute_instance_v2`, `openstack_networking_network_v2`, etc. No AWS EC2, Azure VM, GCP Compute, VMware vSphere resources exist. | The multi-cloud promise is unbacked at the generation layer. Migration *from* AWS works (discovery side); migration *to* anything-but-OpenStack does not. |
| 3 | **Old provider source.** Uses `source = "terraform-providers/openstack" version = "~> 1.51.0"`. The canonical OpenStack provider in 2026 is **`terraform-provider-openstack/openstack ~> 3.x`** on the HashiCorp registry. `terraform-providers/openstack` is the deprecated GitHub-org path. | Generated modules won't init cleanly against modern Terraform Cloud / public registry mirrors. |
| 4 | **No reuse of Terraform Registry modules.** Everything is inlined. No `module "vpc" { source = "terraform-aws-modules/vpc/aws" }`, no equivalents for networking, IAM, RDS, K8s. | 10× more LOC than needed; ignores the ~3,000 battle-tested community modules; security hardening work gets redone poorly. |
| 5 | **No LLM involvement.** Pure deterministic templating. The `ai/` and `planning/` services appear separately; codegen is disconnected from them. | Can't take an architect-agent blueprint and emit IaC for it. Defeats the premise of "AI-driven migration." |
| 6 | **No validation gate.** No `terraform validate`, no `terraform plan` dry-run, no **Checkov**, no **tfsec**, no **OPA/Conftest**. The method claims it "validates with error/warning tracking" but that's shallow linting of emitted strings. | Generated IaC can be *syntactically* broken or *policy*-broken (open SGs, public S3, missing encryption) and ship. Same failure mode as [CVE-2025-48757 for Lovable](https://mattpalmer.io/posts/2025/05/CVE-2025-48757/) — defaults are unsafe. |
| 7 | **No state backend emitted.** No `backend "s3"`, no Swift, no Azure Blob, no GCS. Just the root provider + resources. | Real deployments need remote state with locking + encryption. Missing this means every user has to hand-write it. |
| 8 | **Default CIDRs are `0.0.0.0/0`.** `security_group_rule.remote_ip_prefix` defaults to world-open. | Unsafe defaults ship silently. |
| 9 | **No cost preview.** No Infracost integration. | Users can't see the $/mo impact of a migration plan before running `apply`. |
| 10 | **No drift / diff.** No `terraform plan` JSON output surfaced back to the user. | No preview of what changes; no confidence before apply. |
| 11 | **No Kubernetes, Helm, or Pulumi path.** Terraform only. The `container_orchestration/` service likely covers K8s but is a separate module; unified IaC output is not available. | Users who want GitOps (Argo/Flux + Helm) or typed IaC (Pulumi/CDKTF) have no path. |
| 12 | **Naming conflict with Atlas Build.** `codegen/` in Atlas Build means *application code generation* (React/TypeScript). `codegen/` here means *infrastructure code generation*. Both in one monorepo → immediate semantic collision. | Merge-blocker. Must rename. |
| 13 | **Not an agent.** It's a class called from a service. Atlas's unified architecture is agent-based (PRD_v3 §6.1). Codegen should be a first-class agent consuming the Spec Graph and emitting artifacts. | Doesn't fit the new orchestration model. |
| 14 | **No tests generated.** No Terratest, no policy test scaffolds. | Users can't verify post-apply behavior without hand-writing tests. |
| 15 | **Hardcoded indent = 2 spaces.** Violates `terraform fmt` canonical (which uses its own formatter anyway). | Cosmetic — but every generated file should be piped through `terraform fmt` on emit. |

---

## 3. The Target: `atlas-iac` — IaC Generation Agent

Rename the service from `codegen/` → `iac/` (or keep `codegen/infra/` if you prefer). Rebuild it as a first-class agent in the unified Agent Team.

### 3.1 Core model

```
Spec Graph (app + infra nodes)
        │
        ▼
┌─── IaC Architect Agent (Opus 4.7) ───────┐
│  Reads: Region, ComplianceClass,          │
│         DataResidency, Runtime,           │
│         Provider, WorkloadTopology        │
│  Emits: TargetPlan (abstract resources    │
│         + module choices + module         │
│         versions + state-backend choice)  │
└──────────────┬────────────────────────────┘
               │
               ▼
┌─── IaC Emitter (deterministic) ──────────┐
│  Input: TargetPlan                       │
│  Output: GeneratedArtifact               │
│    - *.tf files (Terraform)              │
│    - *.yaml (K8s/Helm)                   │
│    - *.tftest.hcl (Terratest/native)     │
│    - README.md, CHANGELOG.md             │
│    - .tflint.hcl, .checkov.yaml          │
│  Passes: terraform fmt, terraform        │
│          validate (local mirror)         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌─── Three Merge Gates ─────────────────────┐
│  A. Static: Checkov + tfsec + Trivy IaC   │
│  B. Policy: OPA/Conftest against          │
│     atlas-policies/*.rego                 │
│  C. Cost: Infracost breakdown + budget    │
│     assertion                             │
└──────────────┬───────────────────────────┘
               │   (all green)
               ▼
┌─── Plan Preview ──────────────────────────┐
│  terraform plan -out=plan.bin             │
│  → JSON diff rendered in UI               │
│  → Cost delta vs current                  │
│  → Compliance evidence pack               │
└──────────────┬───────────────────────────┘
               │   (user approves)
               ▼
       Workflow/Execution service
       (applies with monitoring + rollback)
```

### 3.2 Provider matrix (v1 scope)

| Provider | Version | Modules used | Status |
|----------|---------|--------------|--------|
| **openstack** | `terraform-provider-openstack/openstack ~> 3.0` | own templates + `terraform-openstack-modules/*` where available | upgrade existing code |
| **aws** | `hashicorp/aws ~> 5.70` | `terraform-aws-modules/vpc`, `/eks`, `/rds`, `/iam`, `/security-group` | **new** |
| **azurerm** | `hashicorp/azurerm ~> 4.10` | `Azure/terraform-azurerm-{network,aks,sql}` | **new** |
| **google** | `hashicorp/google ~> 6.10` | `terraform-google-modules/network`, `/kubernetes-engine`, `/sql-db` | **new** |
| **vsphere** | `hashicorp/vsphere ~> 2.10` | own templates + `terraform-vsphere-modules` | **new** |
| **kubernetes / helm** | `hashicorp/kubernetes ~> 2.35`, `hashicorp/helm ~> 2.17` | own manifests + upstream charts | **new** |
| **cloudflare** (DNS/TLS for Build Ship pipeline) | `cloudflare/cloudflare ~> 5.0` | own | **new** |

**v2 (Q4 2026):** Pulumi emitter (TypeScript), CDKTF output for code-first teams, Crossplane compositions for K8s-native IaC.

### 3.3 Emitter redesign — stop concatenating strings

Three options, in order of preference:

1. **CDKTF (Terraform CDK)** — Python bindings exist. Write Python, get synthesized HCL. Type-safe, unit-testable, integrates with IDE. Trade-off: CDKTF synth adds a build step.
2. **HCL via `python-hcl2` + template objects** — Build resources as dicts, serialize with a proper HCL writer. Lighter than CDKTF. Requires writing or vendoring a serializer.
3. **Jinja2 templates** — Least ambitious. Better than string concatenation but still textual.

**Recommendation: start with (2).** Build a `hcl_emit.py` module that takes typed resource objects → canonical HCL. Pipe output through `terraform fmt`. Migrate to CDKTF later if the team wants typed authoring.

### 3.4 Policy + security defaults (always-on, not opt-in)

The **IaC Security Agent** is the same merge gate that blocks merges on Atlas Build, re-used here:

- **Checkov** (150+ IaC policies; Bridgecrew-maintained)
- **tfsec** (Aqua)
- **Trivy IaC** (recent CVE awareness)
- **OPA/Conftest** with Atlas-owned `.rego` policies:
  - No `0.0.0.0/0` SG rules except where explicitly tagged `public-ingress=true` in the spec graph
  - No unencrypted volumes / buckets / RDS
  - No plaintext secrets in `user_data`
  - All resources tagged with `atlas:project`, `atlas:compliance`, `atlas:cost-center`
  - Required modules pinned to exact version, not `latest`
  - Remote state backend required and encrypted
- **Terraform registry module provenance check** — only pull modules from pre-approved namespaces (`terraform-aws-modules/*`, `Azure/*`, `terraform-google-modules/*`, internal)

### 3.5 Cost preview (first-class)

Run `infracost breakdown --path .` after emit. Render breakdown + monthly delta inline in the UI. For migrate journeys, compare projected target cost vs current source cost. If the delta exceeds the user's stated budget ceiling (a spec graph property), the merge is blocked.

### 3.6 State backend (always emitted)

Per-target defaults (user-overridable):

| Target | Backend | Config |
|--------|---------|--------|
| OpenStack | `swift` | container, state name, encryption via Barbican |
| AWS | `s3` | bucket + `dynamodb_table` lock, SSE-KMS |
| Azure | `azurerm` | Storage Account + container, MSI auth |
| GCP | `gcs` | bucket, CMEK encryption |
| VMware/on-prem | `http` (Atlas state service) or `consul` | TLS + token auth |

### 3.7 Test scaffolding (emitted per plan)

- `*.tftest.hcl` — Terraform's native testing (GA since 1.6). At minimum: `assert { condition = ..., error_message = ... }` for every critical resource.
- `terratest/` Go scaffold for integration-level assertions.
- `tflint` config pinned to rule sets for the target cloud.
- CI snippet (`.github/workflows/terraform.yml`) running fmt + validate + plan + tests on PR.

---

## 4. Migration Plan (incremental, not a rewrite-from-scratch)

Four phases. Nothing risky up front.

### Phase 1 — Foundations (1–2 weeks)

- [ ] Rename `codegen/` → `iac/` on a feature branch. Update imports, docs.
- [ ] Bump OpenStack provider: `terraform-providers/openstack ~> 1.51` → `terraform-provider-openstack/openstack ~> 3.0`. Add migration notes.
- [ ] Tighten default CIDRs: replace `0.0.0.0/0` defaults with `var.admin_cidr` (required variable).
- [ ] Introduce `hcl_emit.py` — typed resource objects + canonical emitter. Port `compute_instance`, `network`, `router`, `security_group`, `volume`, `floating_ip` to it.
- [ ] Pipe every emitted file through `terraform fmt` before writing.
- [ ] Unit tests for each emitter against fixture `.tf` outputs.

### Phase 2 — Policy + validation gate (2–3 weeks)

- [ ] Integrate Checkov + tfsec + Trivy IaC as a merge gate. Fail fast on criticals.
- [ ] Author initial `atlas-policies/*.rego` (10 rules: tags, encryption, CIDRs, module pinning, backend required, no plaintext secrets, ...).
- [ ] Emit remote state backend config by default.
- [ ] Add `terraform validate` step (local registry mirror or ephemeral cache dir).
- [ ] Emit `tflint` config + `.github/workflows/terraform.yml` per plan.

### Phase 3 — Multi-provider (4–6 weeks)

- [ ] AWS emitter using registry modules (`terraform-aws-modules/*`). Compute, VPC, RDS, IAM, EKS.
- [ ] Azure emitter (parity for Compute, VNet, SQL, AKS).
- [ ] GCP emitter (Compute, VPC, CloudSQL, GKE).
- [ ] VMware vSphere emitter (VM, port groups, datastores).
- [ ] K8s/Helm emitter — compose with `container_orchestration/` service.
- [ ] Provider abstraction layer: one `ComputeInstance` spec → any target.

### Phase 4 — Agent integration + cost/drift (3–4 weeks)

- [ ] Refactor `IaCGenerator` from class → **IaC Architect agent** in the unified Agent Team. Consumes Spec Graph, produces TargetPlan.
- [ ] Split Architect (LLM, plans) from Emitter (deterministic, writes files). LLM never writes HCL directly.
- [ ] Infracost integration. Cost delta in UI.
- [ ] `terraform plan -json` parsed → structured diff rendered in UI.
- [ ] Terratest + `*.tftest.hcl` scaffolding.

### Phase 5 — v2 ambitions (Q4 2026)

- [ ] CDKTF output option (Python/TypeScript).
- [ ] Pulumi emitter.
- [ ] Crossplane compositions for K8s-native IaC.
- [ ] Agentic drift remediation (detect drift, LLM proposes rego + tf diff, merge gate, auto-apply).

---

## 5. Key Architectural Decisions for the User

Four decisions I'd like your call on before starting Phase 1:

1. **Rename.** `codegen/` → `iac/` in the combined repo — confirm? (Matters because Atlas Build also has `codegen/` for application code; keeping both names will hurt.)
2. **Emitter path.** Typed-dict + custom HCL writer (lighter, ships fast) vs CDKTF from day one (heavier, type-safe, slower to ship)? I lean typed-dict, migrate to CDKTF in Phase 5.
3. **Module policy.** Strict "only pre-approved registry namespaces" vs "any public module with a provenance check"? Strict is safer, looser is more useful. I lean strict with a documented expansion process.
4. **LLM-writes-HCL or LLM-writes-plan-only?** I recommend the latter — LLM composes the abstract plan, deterministic code writes HCL. This avoids the well-documented LLM HCL-hallucination problem (wrong resource names, invented attributes). Confirm?

---

## 6. Why This Matters for the Ecosystem

- Atlas Build's **Ship** agent needs to emit domain/DNS/TLS/DB provisioning — all IaC. Right now it doesn't have an emitter; this service becomes the shared one.
- Atlas Migrate's whole value prop depends on **emitting IaC for the target cloud, especially OpenStack/VMware/bare-metal K8s**. Today's two-file string-concat emitter can't carry that promise.
- The spec graph is the common currency. An IaC emitter that doesn't consume it is disconnected from the platform's core idea.
- Security + compliance merge gates work only if they apply at *both* generation points (app code and infra code). The current codegen has no gates.

Put differently: **the current `codegen/` is not "outdated" in the sense of needing a minor refresh. It's a proof-of-concept that got the job done for a demo, and now needs to become the backbone of two products' IaC promise.** Treat Phase 1–4 above as the real build, and write Phase 0 as "honor the learning from the existing code, port what works, rewrite what doesn't."

---

*Companion docs: `docs/ECOSYSTEM_VISION.md` (umbrella product vision), `docs/PRD_v3.md` (Atlas Build product detail). Feedback welcome on the four decisions in §5.*
