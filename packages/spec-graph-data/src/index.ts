export { PACKAGE_NAME } from "./identity.js";

export { createDatabase } from "./client.js";
export type { Database, DrizzleDb, Schema } from "./client.js";

export { withProjectContext } from "./tenant.js";

export { SpecGraphRepo, GraphValidationError } from "./repo/spec-graph.repo.js";
export type { SpecGraphRepoOptions } from "./repo/spec-graph.repo.js";
export { SpecEventRepo } from "./repo/spec-event.repo.js";
export type { AppendEventInput } from "./repo/spec-event.repo.js";
export { SpecSnapshotRepo } from "./repo/spec-snapshot.repo.js";
export type { CreateSnapshotInput } from "./repo/spec-snapshot.repo.js";

export {
  specGraphs,
  specEvents,
  specSnapshots
} from "./schema/index.js";
export type {
  SpecGraphRow,
  NewSpecGraphRow,
  SpecEventRow,
  NewSpecEventRow,
  SpecSnapshotRow,
  NewSpecSnapshotRow
} from "./schema/index.js";

export {
  registry as metricsRegistry,
  repoOpCounter,
  repoOpDuration,
  withSpan
} from "./observability.js";
