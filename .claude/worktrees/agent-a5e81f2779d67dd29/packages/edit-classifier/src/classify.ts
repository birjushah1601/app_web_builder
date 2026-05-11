import { rateField } from "./rules.js";
import type { EditClass, EditClassification, FieldChange } from "./types.js";

export interface ClassifyContext {
  /** Returns the kind (page/route/component/...) for a given nodeId. Caller knows
   *  the graph; classifier doesn't fetch. Defaults: $root → "$root"; edge:* → "edge". */
  kindOf?(nodeId: string): string;
}

const RANK: Record<EditClass, number> = {
  "cosmetic": 0,
  "structural": 1,
  "security-compliance-touching": 2
};

const REVERSE_RANK: EditClass[] = ["cosmetic", "structural", "security-compliance-touching"];

const KIND_ALIASES: Record<string, string> = {
  cmp: "component",
  dt: "designtoken",
  ab: "authboundary",
  ep: "endpoint",
  cs: "clientstate",
  dep: "dependency",
};

function defaultKindOf(nodeId: string): string {
  if (nodeId === "$root") return "$root";
  if (nodeId.startsWith("edge:")) return "edge";
  const colon = nodeId.indexOf(":");
  const raw = colon === -1 ? nodeId : nodeId.slice(0, colon);
  return KIND_ALIASES[raw] ?? raw;
}

export function classifyEdit(changes: FieldChange[], ctx: ClassifyContext = {}): EditClassification {
  const kindOf = ctx.kindOf ?? defaultKindOf;
  if (changes.length === 0) {
    return { class: "cosmetic", reason: "no changes detected", drivers: [] };
  }

  let highest = -1;
  let highestDriver: FieldChange | undefined;
  for (const change of changes) {
    const kind = kindOf(change.nodeId);
    if (change.fieldPath === "$node") {
      if (kind === "authboundary" || kind === "compliance") {
        if (RANK["security-compliance-touching"] > highest) {
          highest = RANK["security-compliance-touching"];
          highestDriver = change;
        }
        continue;
      }
      if (RANK["structural"] > highest) {
        highest = RANK["structural"];
        highestDriver = change;
      }
      continue;
    }
    if (change.fieldPath === "$edge") {
      if (RANK["structural"] > highest) {
        highest = RANK["structural"];
        highestDriver = change;
      }
      continue;
    }
    const tier = rateField(change.nodeId, change.fieldPath, kind);
    if (RANK[tier] > highest) {
      highest = RANK[tier];
      highestDriver = change;
    }
  }

  const cls = REVERSE_RANK[highest];
  const drivers = changes.filter((c) => {
    const tier = c.fieldPath === "$node"
      ? (kindOf(c.nodeId) === "authboundary" || kindOf(c.nodeId) === "compliance" ? "security-compliance-touching" : "structural")
      : c.fieldPath === "$edge"
        ? "structural"
        : rateField(c.nodeId, c.fieldPath, kindOf(c.nodeId));
    return tier === cls;
  });

  const top = highestDriver!;
  const reason = `${cls} edit driven by ${kindOf(top.nodeId)} ${top.nodeId} field ${top.fieldPath}`;

  return { class: cls, reason, drivers };
}
