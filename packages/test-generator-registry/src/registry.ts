import type { Skill, SkillRegistry } from "@atlas/skill-runtime";
import { NoGeneratorForKindError } from "./errors.js";

const NODE_PREFIX = "node:";

export class TestGeneratorRegistry {
  private constructor(private readonly byKind: Map<string, Skill>) {}

  static fromSkillRegistry(skillRegistry: SkillRegistry): TestGeneratorRegistry {
    const byKind = new Map<string, Skill>();
    for (const skill of skillRegistry.list()) {
      const triggers = skill.frontmatter.activate_on;
      for (const trigger of triggers) {
        if (!trigger.startsWith(NODE_PREFIX)) continue;
        const kind = trigger.slice(NODE_PREFIX.length);
        byKind.set(kind, skill);
      }
    }
    return new TestGeneratorRegistry(byKind);
  }

  generatorFor(kind: string): Skill | undefined {
    return this.byKind.get(kind);
  }

  requireGeneratorFor(kind: string): Skill {
    const s = this.byKind.get(kind);
    if (!s) throw new NoGeneratorForKindError(kind);
    return s;
  }

  kinds(): string[] {
    return [...this.byKind.keys()];
  }
}
