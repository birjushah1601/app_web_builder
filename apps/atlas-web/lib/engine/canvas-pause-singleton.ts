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
 * Behavior with Next.js dev (re-eval on file change): the singleton is
 * lost on hot reload, which means any in-flight pause becomes
 * unresolvable until the engine times out and auto-selects the
 * recommended direction. Acceptable because dev-only and the timeout is
 * the same fallback behavior the user gets if they walk away from the
 * UI without clicking.
 */
let instance: CanvasPauseRegistry | null = null;

export function getCanvasPauseRegistry(): CanvasPauseRegistry {
  if (instance === null) {
    instance = new CanvasPauseRegistry();
  }
  return instance;
}

/** TEST-ONLY. Forces the next getCanvasPauseRegistry() call to allocate
 *  a fresh instance. */
export function __resetCanvasPauseRegistryForTesting(): void {
  instance = null;
}
