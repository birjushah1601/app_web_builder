import type { EventBroker } from "./EventBroker";
import { InMemoryEventBroker } from "./InMemoryEventBroker";

/**
 * Process-singleton broker accessor.
 *
 * Both the engine factory (publishes events) and the SSE route handler
 * (subscribes to events) need the same broker instance per Node process.
 * This module owns that instance so neither file holds the state.
 *
 * Pinned to globalThis so Next.js dev HMR can re-evaluate this module
 * without resetting the broker — otherwise engine factory and SSE route
 * end up with different broker instances and events published by one
 * don't reach subscribers of the other. globalThis survives HMR.
 *
 * Tests reset the singleton between cases via __resetEventBrokerForTesting.
 *
 * Future swap-point: when atlas-web moves to multi-instance, this module
 * is the single place that decides which EventBroker implementation to
 * instantiate (InMemory vs Redis-backed). No call site changes.
 */

const GLOBAL_KEY = "__atlas_event_broker__";
type WithBroker = { [GLOBAL_KEY]?: EventBroker };

export function getEventBroker(): EventBroker {
  const g = globalThis as unknown as WithBroker;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new InMemoryEventBroker();
  }
  return g[GLOBAL_KEY];
}

/** TEST-ONLY. Forces the next getEventBroker() call to allocate a fresh
 *  instance. Never call this from production code. Exported with the
 *  __ prefix so it's grep-visible in any review that scans for test-only
 *  surface area leaking into runtime. */
export function __resetEventBrokerForTesting(): void {
  const g = globalThis as unknown as WithBroker;
  g[GLOBAL_KEY] = undefined;
}
