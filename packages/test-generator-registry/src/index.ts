export { TestGeneratorRegistry } from "./registry.js";
export { HumanBaselineStore } from "./baseline-store.js";
export {
  DriftDetector,
  hashActivationBody,
  CalibrationEntrySchema,
  CalibrationFileSchema
} from "./drift.js";
export type { CalibrationEntry, CalibrationFile, DriftReport } from "./drift.js";
export { invokeGenerator } from "./invoker.js";
export type { GeneratorResult, InvokeGeneratorInput } from "./invoker.js";
export { isProtectedTarget, protectedKindOf } from "./protected.js";
export type { ProtectedKind } from "./protected.js";
export { BaselineFileSchema, BaselineAssertionSchema } from "./baseline-schema.js";
export type { BaselineFile, BaselineAssertion } from "./baseline-schema.js";
export {
  NoGeneratorForKindError,
  BaselineMissingError,
  BaselineFileParseError,
  DriftExceededError
} from "./errors.js";
