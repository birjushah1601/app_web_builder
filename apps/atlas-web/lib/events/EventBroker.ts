/**
 * EventBroker — production-shaped interface for streaming ritual checkpoint
 * events from the Node process to subscribed clients (today: SSE + the
 * EventSourceProvider; tomorrow: WebSocket, Redis pub/sub fanout, etc.).
 *
 * Two implementations live alongside this file:
 *   - InMemoryEventBroker: ring-buffer + per-project Set<emit>; the
 *     production backend for single-instance atlas-web deployments.
 *   - RedisEventBroker: stub used only by the conformance suite to prove
 *     the interface holds against a streams-style storage model. Not
 *     wired anywhere — Redis itself is not provisioned by Plan E.0.
 *
 * The interface is what we ship. The backend is swappable.
 */

/** All checkpoint event types broker subscribers care about. Flat string
 *  union (not enum) so TypeScript narrows in switch/reducer code. */
export type RitualEventType =
  | "ritual.started"
  | "ritual.completed"
  | "ritual.escalated"
  | "role.started"
  | "role.completed"
  | "role.failed"
  | "role.retrying"
  | "sandbox.provisioning"
  | "sandbox.provisioned"
  | "sandbox.apply.started"
  | "sandbox.apply.completed";

/** A published event. The broker assigns `id` on publish; it is opaque to
 *  clients (they echo it back via Last-Event-ID for resume). Format today
 *  is `${projectId}:${monotonicCounter}` — do not parse this on the
 *  client; treat it as opaque. */
export interface RitualEvent {
  id: string;
  projectId: string;
  ritualId: string;
  type: RitualEventType;
  payload: Record<string, unknown>;
  /** Epoch milliseconds. Used by the UI for "Xs ago" rendering. */
  ts: number;
}

/** Shape callers pass to broker.publish. id is assigned by the broker. */
export type PublishInput = Omit<RitualEvent, "id">;

/** Options for subscribe — both fields are optional; passing neither
 *  yields a live-only stream from the moment of subscription. */
export interface SubscribeOptions {
  /** Replay events newer than this id before joining the live stream.
   *  Treated as an opaque cursor (do not parse format). When the cursor
   *  is older than the oldest available event in the broker's ring
   *  buffer, the iterator yields a synthetic `stream.gap` marker as
   *  its first event so the client can decide how to recover. */
  sinceEventId?: string;
  /** When fired, the iterator returns and the broker drops the
   *  subscriber from its per-project set. SSE route uses the request's
   *  AbortSignal so disconnect cleanup is automatic. */
  signal?: AbortSignal;
}

/** Production-shaped broker contract. Implementations: InMemoryEventBroker
 *  (default), RedisEventBroker (swap-test stub). */
export interface EventBroker {
  /** Publish an event to the broker. Assigns an id, persists to the
   *  ring buffer, and fans out to every live subscriber for that
   *  project. Returns the assigned RitualEvent (callers may need the id
   *  for logging). Never throws on subscriber backpressure — slow
   *  subscribers drop oldest queued events. */
  publish(event: PublishInput): Promise<RitualEvent>;

  /** Subscribe to a project's event stream. Yields each event for that
   *  project, optionally replaying from a cursor. The iterator returns
   *  cleanly when opts.signal aborts; broker removes the subscriber
   *  from its internal set on return. */
  subscribe(projectId: string, opts?: SubscribeOptions): AsyncIterable<RitualEvent>;
}
