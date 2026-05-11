# @atlas/role-researcher

Conductor-dispatched Role that produces an `InspirationBrief` for the Designer role (Plan S.3) by querying a local YAML catalog and (optionally) Brave Search.

## Install
```bash
pnpm install
```

## Test
```bash
pnpm test
```

## Usage (called by RitualEngine, not directly)

```ts
import { ResearcherRole } from "@atlas/role-researcher";

const researcher = new ResearcherRole({
  llm,
  webAdapter: process.env.ATLAS_RESEARCH_WEB === "true"
    ? new BraveSearchAdapter({ apiKey: process.env.BRAVE_SEARCH_API_KEY! })
    : null
});

await conductor.dispatch({ role: researcher, ... });
```

## Catalog content

`catalog/*.yaml` — one file per category. Schema enforced by `catalog-validate.test.ts`. To add a category: copy an existing file, edit, run `pnpm test`. CI rejects malformed YAMLs.
