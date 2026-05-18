---
name: gen-test-media-asset
description: Generate provider + license + size tests for a MediaAsset node
activate_on: "node:mediaasset"
model_hint: haiku
---

# Generate Test — MediaAsset

## When to use

Auto-activated when a `MediaAsset` node is added.

## Checklist

- [ ] Provider test: if MediaAsset.source=`"generated"`, confirm providerCapability is set (I11).
- [ ] License test: if source=`"stock"`, confirm licenseStatus is in the allowlist.
- [ ] Size test: image assets under 500KB; video under 10MB for v1 (adjust per Page's performance budget).
- [ ] Kind test: MediaAsset.kind ∈ `{image, icon, illustration}` in v1 (I14).
- [ ] Emit as Test node with `covers`-edge → MediaAsset.
