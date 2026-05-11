import type { GateResult, GateRunInput, GateRunner } from "./types.js";

export async function runSyncGates(runners: GateRunner[], input: GateRunInput): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const runner of runners) {
    const r = await runner.run(input);
    results.push(r);
    if (r.status === "failed") break;
  }
  return results;
}
