import { createHash } from "node:crypto";
import { z } from "zod";
import type { SkillRegistry } from "@atlas/skill-runtime";
import type { SpecGraph } from "@atlas/spec-graph-schema";
import type { TestGeneratorRegistry } from "./registry.js";
import type { HumanBaselineStore } from "./baseline-store.js";
import { invokeGenerator } from "./invoker.js";

export const CalibrationEntrySchema = z
  .object({
    nodeId: z.string().min(1),
    kind: z.string().min(1),
    expectedActivationBodyHash: z.string().min(1),
    pinnedAt: z.string().min(1)
  })
  .strict();

export const CalibrationFileSchema = z
  .object({
    version: z.number().int().positive(),
    entries: z.array(CalibrationEntrySchema)
  })
  .strict();

export type CalibrationEntry = z.infer<typeof CalibrationEntrySchema>;
export type CalibrationFile = z.infer<typeof CalibrationFileSchema>;

export interface DriftReport {
  entries: Array<{ nodeId: string; drifted: boolean; diff?: string }>;
  driftedCount: number;
  totalCount: number;
}

export function hashActivationBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export interface DriftDetectorDeps {
  registry: TestGeneratorRegistry;
  skillRegistry: SkillRegistry;
  baselines: HumanBaselineStore;
}

export class DriftDetector {
  constructor(private readonly deps: DriftDetectorDeps) {}

  async check(calibration: CalibrationFile, graph: SpecGraph): Promise<DriftReport> {
    const parsed = CalibrationFileSchema.parse(calibration);
    const entries: DriftReport["entries"] = [];
    let drifted = 0;

    for (const c of parsed.entries) {
      const node = graph.nodes[c.nodeId];
      if (!node) {
        entries.push({ nodeId: c.nodeId, drifted: true, diff: `node missing from graph` });
        drifted++;
        continue;
      }
      const result = invokeGenerator({
        node,
        registry: this.deps.registry,
        skillRegistry: this.deps.skillRegistry,
        baselines: this.deps.baselines
      });
      const actualHash = hashActivationBody(result.activationRecord.body);
      if (actualHash !== c.expectedActivationBodyHash) {
        entries.push({
          nodeId: c.nodeId,
          drifted: true,
          diff: `hash mismatch — expected ${c.expectedActivationBodyHash.slice(0, 8)} got ${actualHash.slice(0, 8)}`
        });
        drifted++;
      } else {
        entries.push({ nodeId: c.nodeId, drifted: false });
      }
    }

    return { entries, driftedCount: drifted, totalCount: parsed.entries.length };
  }
}
