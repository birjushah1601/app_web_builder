export { main, runMerge } from "./cli.js";
export { dispatchMerge, patternFor, UnknownPatternError } from "./merge/dispatcher.js";
export { mergeEventsJsonl } from "./merge/events-jsonl.js";
export {
  mergeSpecGraphJsonFallback,
  mergeSpecGraphJsonMirrorFirst
} from "./merge/spec-graph-json.js";
export { installDriver } from "./install/install.js";
export { uninstallDriver } from "./install/uninstall.js";
export { createLogger } from "./logger.js";
export {
  mergeInvocations,
  mergeDuration,
  mirrorUnreachable,
  registry,
  withMergeSpan
} from "./observability.js";
