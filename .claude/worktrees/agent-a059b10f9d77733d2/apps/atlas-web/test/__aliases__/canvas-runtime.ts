/**
 * Vitest-only alias for `@atlas/canvas-runtime`.
 *
 * Re-exports ONLY the runtime values + types atlas-web's CanvasShell needs.
 * The published package's `export *` chain transitively triggers
 * `@atlas/ritual-engine` → which imports back from `@atlas/canvas-runtime`
 * (events discriminated union). Vite/jsdom can't untangle the circular
 * graph at module-init; production (Next bundler) masks it by resolving
 * each module once. This shim sidesteps the circular hazard for tests.
 */
// Use absolute file paths via our @ alias would need adjustment. The
// `..` traversal here is relative to apps/atlas-web/test/__aliases__/.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
export { CanvasModeRegistry } from "../../../../packages/canvas-runtime/src/registry.js";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
export { personaFilter } from "../../../../packages/canvas-runtime/src/persona-filter.js";

export type { CanvasManifest, CanvasMode, ArtifactKind } from "../../../../packages/canvas-runtime/src/types.js";
