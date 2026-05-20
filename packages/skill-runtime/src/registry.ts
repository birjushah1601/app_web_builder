import { z } from "zod";
import type { Skill } from "./skill.js";
import type { IntentClassifier } from "./classifier.js";
import { topoSort } from "./topo.js";

export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`SkillNotFoundError: skill "${name}" not found in registry`);
    this.name = "SkillNotFoundError";
  }
}

export class SkillInputValidationError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(skillName: string, issues: z.ZodIssue[]) {
    super(`SkillInputValidationError: inputs for skill "${skillName}" failed validation`);
    this.name = "SkillInputValidationError";
    this.issues = issues;
  }
}

export interface ActivationRecord {
  skillName: string;
  validatedInputs: unknown | null;
  body: string;
  activatedAt: Date;
}

export class SkillRegistry {
  private readonly byName: Map<string, Skill>;
  private readonly classifier: IntentClassifier | undefined;

  constructor(skills: Skill[], classifier?: IntentClassifier) {
    this.byName = new Map(skills.map((s) => [s.frontmatter.name, s]));
    this.classifier = classifier;
  }

  /** Returns the skill with the given name, or `undefined` if not found. */
  get(name: string): Skill | undefined {
    return this.byName.get(name);
  }

  /** Returns all loaded skills as a new array. */
  list(): Skill[] {
    return [...this.byName.values()];
  }

  /** Returns the names of all skills whose `composes` field references `name`. */
  composedBy(name: string): string[] {
    return this.list()
      .filter((s) => s.frontmatter.composes?.includes(name))
      .map((s) => s.frontmatter.name);
  }

  /**
   * Validates `args` against the skill's `inputs` Zod schema (if defined) and
   * returns an `ActivationRecord` for downstream consumers (the Conductor, D.1).
   * Throws `SkillNotFoundError` or `SkillInputValidationError` on failure.
   */
  activate(name: string, args: unknown): ActivationRecord {
    const skill = this.byName.get(name);
    if (!skill) throw new SkillNotFoundError(name);

    const inputsSchema = skill.frontmatter.inputs;
    let validatedInputs: unknown | null = null;

    if (inputsSchema != null && typeof (inputsSchema as { parse?: unknown }).parse === "function") {
      const schema = inputsSchema as z.ZodTypeAny;
      const result = schema.safeParse(args);
      if (!result.success) {
        throw new SkillInputValidationError(name, result.error.issues);
      }
      validatedInputs = result.data;
    }

    return {
      skillName: name,
      validatedInputs,
      body: skill.body,
      activatedAt: new Date()
    };
  }

  /**
   * Returns all skills in the transitive `composes` closure of `rootName`,
   * ordered dependency-first (leaves first, root last).
   * Throws `CyclicDependencyError` if a cycle is detected.
   * Throws `SkillNotFoundError` if `rootName` is not in the registry.
   */
  resolveComposeOrder(rootName: string): string[] {
    if (!this.byName.has(rootName)) throw new SkillNotFoundError(rootName);

    // Build a sub-graph of just the relevant skills
    const graph: Record<string, string[]> = {};
    const toVisit = [rootName];
    const visited = new Set<string>();

    while (toVisit.length > 0) {
      const name = toVisit.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      const skill = this.byName.get(name);
      const deps = skill?.frontmatter.composes ?? [];
      graph[name] = deps;
      for (const dep of deps) {
        if (!visited.has(dep)) toVisit.push(dep);
      }
    }

    return topoSort(graph);
  }

  /**
   * Classifies `intent` using the injected classifier and returns the matching
   * `Skill[]` in confidence-descending order.
   * Throws if no classifier was provided at construction time.
   */
  async match(intent: string): Promise<Skill[]> {
    if (!this.classifier) {
      throw new Error("No IntentClassifier was provided to this SkillRegistry instance");
    }
    const result = await this.classifier.classify(intent);
    return result.matches
      .sort((a, b) => b.confidence - a.confidence)
      .map((m) => this.byName.get(m.name))
      .filter((s): s is Skill => s !== undefined);
  }
}
