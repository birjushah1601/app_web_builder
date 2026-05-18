import { CanvasPauseRegistry } from "@atlas/ritual-engine";

/**
 * Process-singleton CanvasPauseRegistry.
 *
 * The engine factory wires `cache(...)` per request, which means each
 * request gets a fresh `RitualEngine`. Canvas pauses cross requests:
 * request A starts a ritual that awaits an option, request B's Server
 * Action resolves that option. They MUST share the same registry
 * instance, otherwise resolve becomes a no-op (the pending waiter lives
 * in a different in-memory map).
 *
 * Pinned to globalThis (same pattern as broker-singleton, commit 55c52b3)
 * because Next.js dev gives Server Actions and Server Components separate
 * module graphs — a plain `let instance` ends up forked into two registry
 * instances (engine waits on A, selectDesignDirection resolves on B) so
 * the click is a silent no-op. globalThis survives both that fork and
 * HMR.
 *
 * Tests reset the singleton between cases via
 * __resetCanvasPauseRegistryForTesting.
 */

const GLOBAL_KEY = "__atlas_canvas_pause_registry__";
type WithRegistry = { [GLOBAL_KEY]?: CanvasPauseRegistry };

export function getCanvasPauseRegistry(): CanvasPauseRegistry {
  const g = globalThis as unknown as WithRegistry;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CanvasPauseRegistry();
  }
  return g[GLOBAL_KEY];
}

/** TEST-ONLY. Forces the next getCanvasPauseRegistry() call to allocate
 *  a fresh instance. */
export function __resetCanvasPauseRegistryForTesting(): void {
  const g = globalThis as unknown as WithRegistry;
  g[GLOBAL_KEY] = undefined;
}
