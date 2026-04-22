# Atlas Cluster Helm Chart

Provisions the cluster prerequisites Atlas Run depends on. The deploy orchestrator (`@atlas/deploy-orchestrator`) targets the primitives this chart sets up.

## Bootstrap order

Install the upstream prerequisites first, then this chart on top.

```bash
# 1. Argo CD
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd -n argocd --create-namespace

# 2. Knative Serving
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.16.0/serving-crds.yaml
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.16.0/serving-core.yaml
kubectl apply -f https://github.com/knative/net-kourier/releases/download/knative-v1.16.0/kourier.yaml

# 3. cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set installCRDs=true

# 4. Cloudflare API token Secret (the ClusterIssuer uses this for DNS-01)
kubectl create secret generic cloudflare-api-token \
  --namespace=cert-manager \
  --from-literal=api-token=YOUR_CLOUDFLARE_API_TOKEN

# 5. THIS chart — namespaces + the ClusterIssuer that references the token above
helm install atlas-cluster ./deploy/atlas-helm
```

## What this chart provides

- `atlas-projects` namespace (where Knative `Service` + `Certificate` resources land)
- `atlas-platform` namespace (where future observability + GlitchTip Helm releases land per C-2)
- `letsencrypt-cloudflare-dns01` ClusterIssuer wired to the Cloudflare token Secret

## What this chart does NOT provide

- Argo CD itself (install via the official chart, see step 1 above)
- Knative Serving itself (install via official manifests, see step 2)
- cert-manager itself (install via the official chart, see step 3)
- The Cloudflare API token Secret (you create it; we never store it in the chart)

The deliberate split: upstream tools handle their own lifecycle; Atlas only owns the glue.

## ADR reference

ADR-001 §1 chose this DIY-on-K8s shape over Coolify / Dokploy. See `docs/adr/2026-04-21-oss-stack-pivot.md`.
