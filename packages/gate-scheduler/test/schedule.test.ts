import { describe, it, expect } from "vitest";
import { scheduleGates } from "../src/schedule.js";
import type { EditClassification } from "@atlas/edit-classifier";

const cosmetic: EditClassification = { class: "cosmetic", reason: "x", drivers: [] };
const structural: EditClassification = { class: "structural", reason: "x", drivers: [] };
const sct: EditClassification = { class: "security-compliance-touching", reason: "x", drivers: [] };

describe("scheduleGates", () => {
  it("cosmetic: L1+L2 sync; L3+L4+L5 async", () => {
    const s = scheduleGates(cosmetic);
    expect(s.sync).toEqual(["L1", "L2"]);
    expect(s.async).toEqual(["L3", "L4", "L5"]);
    expect(s.requiresHumanGate).toBe(false);
  });

  it("structural: L1-L5 all sync", () => {
    const s = scheduleGates(structural);
    expect(s.sync).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(s.async).toEqual([]);
    expect(s.requiresHumanGate).toBe(false);
  });

  it("security-compliance-touching: L1-L5 sync + explicit human gate flag", () => {
    const s = scheduleGates(sct);
    expect(s.sync).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(s.async).toEqual([]);
    expect(s.requiresHumanGate).toBe(true);
  });
});
