---
name: cite-references
description: Quality bar for citing references inside an InspirationBrief
activate_on: visualize
model_hint: haiku
---

# Cite References

## When to use

When emitting any reference inside an `InspirationBrief`, this skill defines the quality bar for the `why` field.

## Checklist

- [ ] `why` names a specific design choice the reference makes well: ("editorial serif", "hero gives 60% to a single dish", "command palette over navigation").
- [ ] Avoid vague praise ("looks great", "modern design", "clean").
- [ ] If `palettePreview` is present, it MUST come from observed brand colors, not invented.
- [ ] If `typographyPreview` is present, it MUST be the actual font family (verifiable via DevTools), not a generic class ("sans-serif").

## Anti-patterns

- "modern, clean, professional" as the `why`
- Hex codes that don't match the cited site
- Generic font families ("system-ui", "sans-serif") in `typographyPreview.primary`
