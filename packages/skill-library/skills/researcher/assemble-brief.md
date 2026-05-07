---
name: assemble-brief
description: Compose an InspirationBrief from local catalog hits + web search results
activate_on: visualize
model_hint: haiku
---

# Assemble Brief

## When to use

The Researcher role composes this skill in the LLM call that turns local-catalog + web-search inputs into a structured `InspirationBrief`.

## Checklist

- [ ] Cite local-catalog references with `sourceTier: "local-catalog"`; web hits with `sourceTier: "web"`.
- [ ] 3-5 references total. If you have more candidates, pick the most diverse + relevant.
- [ ] Carry over palettePreview / typographyPreview from local entries; do NOT invent them for web hits unless visible in the description.
- [ ] patternsThatWin / patternsThatLose: synthesize from local entry + general knowledge.
- [ ] audienceCues: echo the designIntent's cues; do NOT add new ones.

## Output contract

`InspirationBrief` per `packages/role-researcher/src/types.ts`.

## Anti-patterns

- Don't fabricate URLs or palettes for web hits — if you don't see them, omit.
- Don't drop the local entry just because web hits are richer; mix sources.
- Don't write generic patterns ("use a hero section"); be specific to the category.
