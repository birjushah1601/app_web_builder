import type { ActivationRecord, SkillRegistry } from "@atlas/skill-runtime";
import type { SpecGraph } from "@atlas/spec-graph-schema";
import type { BaselineAssertion } from "./baseline-schema.js";
import type { HumanBaselineStore } from "./baseline-store.js";
import type { TestGeneratorRegistry } from "./registry.js";
import { protectedKindOf } from "./protected.js";

type Node = SpecGraph["nodes"][string];

export interface InvokeGeneratorInput {
  node: Node;
  registry: TestGeneratorRegistry;
  skillRegistry: SkillRegistry;
  baselines: HumanBaselineStore;
}

export interface GeneratorResult {
  activationRecord: ActivationRecord;
  emittedTestSource: "generated" | "baseline";
  baselineAssertions: BaselineAssertion[];
}

export function invokeGenerator(input: InvokeGeneratorInput): GeneratorResult {
  const { node, registry, skillRegistry, baselines } = input;
  const skill = registry.requireGeneratorFor(node.kind);
  const protectedKind = protectedKindOf(node);

  if (!protectedKind) {
    const activationRecord = skillRegistry.activate(skill.frontmatter.name, { node });
    return { activationRecord, emittedTestSource: "generated", baselineAssertions: [] };
  }

  const assertions = baselines.getAssertions(protectedKind);
  const augmentedBody = composeBody(skill.body, assertions);
  const activationRecord: ActivationRecord = {
    skillName: skill.frontmatter.name,
    validatedInputs: { node },
    body: augmentedBody,
    activatedAt: new Date()
  };
  return { activationRecord, emittedTestSource: "baseline", baselineAssertions: assertions };
}

function composeBody(skillBody: string, assertions: BaselineAssertion[]): string {
  const lines = [
    skillBody.trim(),
    "",
    "## Human-authored baseline assertions (non-overridable — I13)",
    ""
  ];
  for (const a of assertions) {
    lines.push(`- [${a.id}] ${a.checklistItem}`);
    lines.push(`  _rationale: ${a.rationale}_`);
    if (a.mustEmitTest) lines.push(`  **mustEmitTest: true**`);
  }
  return lines.join("\n");
}
