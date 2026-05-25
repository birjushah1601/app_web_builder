export * from "./personas.js";
export * from "./state.js";
export * from "./events.js";
export * from "./approval.js";
export * from "./risk-accept.js";
export * from "./errors.js";
export * from "./engine.js";
export { replayEventsToSnapshot, type SpecEventRowLike, type RitualHydrator } from "./hydrator.js";
export { buildPriorRitualContext, isPriorRitualContext, type PriorRitualContext } from "./prior-ritual-context.js";
export {
  CanvasPauseRegistry,
  DEFAULT_CANVAS_PAUSE_TIMEOUT_MS,
  type CanvasOptionResolution,
  type PlanCheckpoint,
  type PlanApprovalResolution
} from "./canvas-pause.js";
// Plan A: re-export RitualAbortedError so consumers see one canonical name.
// Lives in @atlas/conductor (where it's thrown) but the engine's abort() API
// surfaces it to callers, so we expose it from this barrel as a convenience.
export { RitualAbortedError } from "@atlas/conductor";
