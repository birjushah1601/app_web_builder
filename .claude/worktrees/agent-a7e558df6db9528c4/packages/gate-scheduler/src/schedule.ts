import type { EditClassification } from "@atlas/edit-classifier";
import type { GateLayer } from "./types.js";

export interface GateSchedule {
  sync: GateLayer[];
  async: GateLayer[];
  requiresHumanGate: boolean;
}

const ALL_GATES: GateLayer[] = ["L1", "L2", "L3", "L4", "L5"];

export function scheduleGates(classification: EditClassification): GateSchedule {
  switch (classification.class) {
    case "cosmetic":
      return { sync: ["L1", "L2"], async: ["L3", "L4", "L5"], requiresHumanGate: false };
    case "structural":
      return { sync: ALL_GATES, async: [], requiresHumanGate: false };
    case "security-compliance-touching":
      return { sync: ALL_GATES, async: [], requiresHumanGate: true };
  }
}
