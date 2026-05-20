# @atlas/test-generator-registry

Resolves a spec-graph node to the correct test-generator skill, injects human-authored baseline assertions for protected targets (AuthBoundary, PII Models, non-baseline ComplianceClass), and detects drift against a locked calibration dataset.

This package is the C.3 deliverable of the Atlas Phase A plan. It is the bridge between the skill library (C.2) and the Developer / Security / Accessibility roles (D.3 / D.4 / D.5): roles call `invokeGenerator(node, ...)` to get a prompt body that already contains the non-overridable baselines.

## Why baselines are human-authored

PRD §10.1 records the Council's concern that LLM-generated tests drift under model upgrades. Anchoring the security + compliance floor in committed YAML means the floor is invariant across model swaps and prompt refactors.

## API

```ts
import {
  TestGeneratorRegistry,
  HumanBaselineStore,
  invokeGenerator,
  DriftDetector
} from "@atlas/test-generator-registry";
import { SkillRegistry, loadSkillsFromDir } from "@atlas/skill-runtime";

const skills = loadSkillsFromDir("packages/skill-library/skills/test-generators");
const skillReg = new SkillRegistry(skills);
const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
const baselines = await HumanBaselineStore.fromDir(".atlas/baselines");

const result = invokeGenerator({
  node: graph.nodes["ab-admin"], // AuthBoundary
  registry: reg,
  skillRegistry: skillReg,
  baselines
});

// result.emittedTestSource === "baseline"
// result.activationRecord.body contains the generator skill + appended baselines
// result.baselineAssertions lists the injected assertions
```

## Protected target mapping (mirrors I13)

| Node kind | Protected when | Baseline file |
|-----------|---------------|---------------|
| `authboundary` | always | `.atlas/baselines/authboundary.yaml` |
| `model` | `piiClassification !== "none"` | `.atlas/baselines/pii-model.yaml` |
| `compliance` | `name !== "baseline"` | `.atlas/baselines/compliance.yaml` |

Any other node kind yields `emittedTestSource: "generated"` with no baseline injection.

## Drift detection

The `DriftDetector` re-invokes generators for every calibration entry, hashes the activation body with SHA-256, and compares against the pinned hash. Any mismatch is reported with a short diff. Intended use: nightly CI job + a `pre-publish` check on the skill-library repo.

## CLI

```bash
node tools/test-gen-cli.mjs baseline list
node tools/test-gen-cli.mjs baseline show authboundary
node tools/test-gen-cli.mjs drift check calibration.json
```

Or via root pnpm scripts:

```bash
pnpm tg:baseline list
pnpm tg:baseline show authboundary
pnpm tg:drift calibration.json
```

## Dependencies

- `@atlas/skill-runtime` — SkillRegistry, ActivationRecord, skill loader.
- `@atlas/spec-graph-schema` — node kinds, I13 definitions.

## Exit criteria (C.3 complete)

- [x] All 14 test-generator skills indexed by kind.
- [x] Baseline YAMLs committed at repo-root `.atlas/baselines/`.
- [x] `invokeGenerator` emits `source: "baseline"` for all three protected kinds.
- [x] `DriftDetector` reports 0 drift on current snapshot.
- [x] CLI smoke-tested in Vitest.
