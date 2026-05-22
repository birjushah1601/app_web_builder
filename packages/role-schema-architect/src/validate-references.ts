import type { DataModel } from "./types.js";

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: "broken-reference" | "duplicate-name"; message: string };

export function validateReferences(dm: DataModel): ValidateResult {
  const entityNames = new Set<string>();
  for (const e of dm.entities) {
    if (entityNames.has(e.name)) {
      return { ok: false, reason: "duplicate-name", message: `duplicate entity: ${e.name}` };
    }
    entityNames.add(e.name);

    const fieldNames = new Set<string>();
    for (const f of e.fields) {
      if (fieldNames.has(f.name)) {
        return { ok: false, reason: "duplicate-name", message: `duplicate field: ${e.name}.${f.name}` };
      }
      fieldNames.add(f.name);
    }
  }

  const byName = new Map(dm.entities.map((e) => [e.name, e]));

  for (const e of dm.entities) {
    for (const f of e.fields) {
      if (!f.references) continue;
      const target = byName.get(f.references.entity);
      if (!target) {
        return {
          ok: false,
          reason: "broken-reference",
          message: `${e.name}.${f.name} references missing entity '${f.references.entity}'`
        };
      }
      const hasField = target.fields.some((tf) => tf.name === f.references!.field);
      if (!hasField) {
        return {
          ok: false,
          reason: "broken-reference",
          message: `${e.name}.${f.name} references missing field '${f.references.entity}.${f.references.field}'`
        };
      }
    }

    const fieldNameSet = new Set(e.fields.map((f) => f.name));
    for (const idx of e.indexes) {
      for (const col of idx.columns) {
        if (!fieldNameSet.has(col)) {
          return {
            ok: false,
            reason: "broken-reference",
            message: `${e.name} index '${idx.name}' references missing column '${col}'`
          };
        }
      }
    }
  }

  return { ok: true };
}
