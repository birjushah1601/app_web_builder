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
  | "ritual.escalation_requested"
  | "role.started"
  | "role.completed"
  | "role.failed"
  | "role.retrying"
  | "sandbox.provisioning"
  | "sandbox.provisioned"
  | "sandbox.apply.started"
  | "sandbox.apply.completed"
  // Plan P: gate events (Plan I) — surface on the rail timeline as their own rows.
  | "security.started"
  | "security.completed"
  | "security.failed"
  | "accessibility.started"
  | "accessibility.completed"
  | "accessibility.failed"
  // Plan P: auto-fix events (Plan L) — increment a meta-state counter on the timeline.
  | "auto_fix.attempted"
  | "auto_fix.budget_exhausted"
  | "auto_fix.failed"
  // Plan S.5: Visual-Quality merge gate — surfaces as its own row on the
  // rail timeline (alongside security + accessibility). started/passed/failed
  // light the row state; skipped flags scope-out (backend-only / refactor);
  // completed signals the gate has finished one way or another; errored is
  // an internal crash (sandbox unreachable, screenshot timeout, etc.).
  | "visual_quality.started"
  | "visual_quality.passed"
  | "visual_quality.failed"
  | "visual_quality.skipped"
  | "visual_quality.completed"
  | "visual_quality.errored"
  // Plan S.2 — Researcher role events. Surfaced as a brief card slotted
  // between the architect and developer rows in the RitualTimeline. The
  // started/skipped variants are accepted by the broker but currently
  // unused by the UI (kept for future telemetry / future "researching…"
  // indicator); the completed payload carries the InspirationBrief that
  // the ResearcherBriefCard renders. failed surfaces an error string.
  | "researcher.brief.started"
  | "researcher.brief.completed"
  | "researcher.brief.skipped"
  | "researcher.brief.failed"
  // Plan S.4 — canvas + architect manifest + designer events. CanvasShellWired's
  // useCanvasManifest hook reads architect.canvas_manifest.emitted; its
  // useDesignerProposal hook reads canvas.options.requested. The other variants
  // (designer.* / canvas.option.selected / canvas.refinement.*) flow through
  // for future UI consumers (timeline rows, telemetry).
  | "architect.canvas_manifest.emitted"
  | "designer.proposal.emitted"
  | "designer.proposal.failed"
  | "canvas.options.requested"
  | "canvas.option.selected"
  | "canvas.refinement.started"
  | "canvas.refinement.completed"
  // Plan SPU — Designer three-pass (draft → critique → revise) lifecycle.
  // Surfaces on the rail timeline once mapped through factory.ts; for now
  // the broker accepts them so the SSE path doesn't drop the events.
  | "designer.draft.completed"
  | "designer.critique.started"
  | "designer.critique.completed"
  | "designer.revise.started"
  | "designer.revise.completed"
  // Plan SPU — AssetGenerator lifecycle. Fired when the engine dispatches
  // the role after the canvas pause resolves; manifest is folded into the
  // developer's priorArtifact so generated code can reference real image URLs.
  | "asset.gen.started"
  | "asset.gen.completed"
  | "asset.gen.failed"
  // Architect triage gate. Emitted when pass1 detects ambiguity and asks
  // the user a clarifying question. The role pauses and dispatch returns;
  // without this event the canvas keeps showing the architect-pending
  // spinner because no role.completed/failed terminator arrives.
  | "architect.triage.needs_input"
  // Plan L0 — Build gate. Fired by BuildGateRole; surfaces as its own row
  // on the rail timeline alongside security/a11y/visual-quality.
  | "build-gate.started"
  | "build-gate.passed"
  | "build-gate.failed"
  | "build-gate.completed"
  // SchemaArchitect three-pass (proposal → critique → revise) lifecycle +
  // schema direction selection. Forwarded from factory.ts so SSE clients
  // (SchemaCanvas and later consumers) can react to each phase.
  | "schema_architect.proposal.started"
  | "schema_architect.proposal.emitted"
  | "schema_architect.proposal.completed"
  | "schema_architect.proposal.failed"
  | "schema_architect.proposal.skipped"
  | "schema_architect.critique.started"
  | "schema_architect.critique.completed"
  | "schema_architect.revise.started"
  | "schema_architect.revise.completed"
  | "schema.direction.selected";

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
