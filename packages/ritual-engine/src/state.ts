import { z } from "zod";
import { InvalidTransitionError } from "./errors.js";

export const RitualStateSchema = z.enum(["visualize", "agree", "build", "done", "escalated", "aborted"]);
export type RitualState = z.infer<typeof RitualStateSchema>;

export type RitualTransition =
  | { kind: "artifact_emitted" }
  | { kind: "artifact_emitted_cosmetic" }
  | { kind: "approved" }
  | { kind: "changes_requested" }
  | { kind: "merge_gates_green" }
  | { kind: "escalate"; reason: string }
  | { kind: "abort"; reason: string };

const TABLE: Record<string, RitualState> = {
  "visualize:artifact_emitted": "agree",
  "visualize:artifact_emitted_cosmetic": "build",
  "agree:approved": "build",
  "agree:changes_requested": "visualize",
  "build:merge_gates_green": "done"
};

const TERMINAL = new Set<RitualState>(["done", "escalated", "aborted"]);

export function isTerminal(state: RitualState): boolean {
  return TERMINAL.has(state);
}

export function applyTransition(state: RitualState, tx: RitualTransition): RitualState {
  if (tx.kind === "escalate") {
    if (TERMINAL.has(state)) throw new InvalidTransitionError(state, tx.kind);
    return "escalated";
  }
  if (tx.kind === "abort") {
    if (TERMINAL.has(state)) throw new InvalidTransitionError(state, tx.kind);
    return "aborted";
  }
  const key = `${state}:${tx.kind}`;
  const next = TABLE[key];
  if (!next) throw new InvalidTransitionError(state, tx.kind);
  return next;
}
