import type { EventBroker } from "./EventBroker";
import { InMemoryEventBroker } from "./InMemoryEventBroker";

/**
 * Process-singleton broker accessor.
 *
 * Both the engine factory (publishes events) and the SSE route handler
 * (subscribes to events) need the same broker instance per Node process.
 * This module owns that instance so neither file holds the state.
 *
 * Tests reset the singleton between cases via __resetEventBrokerForTesting.
 *
 * Future swap-point: when atlas-web moves to multi-instance, this module
 * is the single place that decides which EventBroker implementation to
 * instantiate (InMemory vs Redis-backed). No call site changes.
 */

let instance: EventBroker | null = null;

export function getEventBroker(): EventBroker {
  if (instance === null) {
    instance = new InMemoryEventBroker();
  }
  return instance;
}

/** TEST-ONLY. Forces the next getEventBroker() call to allocate a fresh
 *  instance. Never call this from production code. Exported with the
 *  __ prefix so it's grep-visible in any review that scans for test-only
 *  surface area leaking into runtime. */
export function __resetEventBrokerForTesting(): void {
  instance = null;
}
