import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  BaselineFileSchema,
  type BaselineAssertion,
  type ProtectedKind
} from "./baseline-schema.js";
import { BaselineFileParseError, BaselineMissingError } from "./errors.js";

export class HumanBaselineStore {
  private constructor(private readonly byKind: Map<ProtectedKind, BaselineAssertion[]>) {}

  static async fromDir(dir: string): Promise<HumanBaselineStore> {
    const entries = await readdir(dir);
    const yamlFiles = entries.filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"));
    const byKind = new Map<ProtectedKind, BaselineAssertion[]>();
    for (const file of yamlFiles) {
      const path = join(dir, file);
      const raw = await readFile(path, "utf8");
      let parsed: unknown;
      try {
        parsed = yaml.load(raw);
      } catch (err) {
        throw new BaselineFileParseError(path, err);
      }
      const result = BaselineFileSchema.safeParse(parsed);
      if (!result.success) {
        throw new BaselineFileParseError(path, new Error(JSON.stringify(result.error.issues)));
      }
      byKind.set(result.data.kind, result.data.assertions);
    }
    return new HumanBaselineStore(byKind);
  }

  kinds(): ProtectedKind[] {
    return [...this.byKind.keys()];
  }

  getAssertions(kind: ProtectedKind): BaselineAssertion[] {
    const a = this.byKind.get(kind);
    if (!a) throw new BaselineMissingError(kind);
    return a;
  }
}
