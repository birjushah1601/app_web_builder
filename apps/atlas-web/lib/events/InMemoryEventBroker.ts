import type { EventBroker, PublishInput, RitualEvent, SubscribeOptions } from "./EventBroker";

const RING_BUFFER_SIZE = 200;
const SUBSCRIBER_QUEUE_SIZE = 64;

interface ProjectState {
  counter: bigint;
  buffer: RitualEvent[];
  subscribers: Set<Subscriber>;
}

interface Subscriber {
  queue: RitualEvent[];
  wake: (() => void) | null;
  closed: boolean;
}

export class InMemoryEventBroker implements EventBroker {
  private readonly projects = new Map<string, ProjectState>();

  async publish(input: PublishInput): Promise<RitualEvent> {
    const state = this.getOrCreate(input.projectId);
    state.counter += BigInt(1);
    const event: RitualEvent = {
      ...input,
      id: `${input.projectId}:${state.counter.toString()}`
    };
    state.buffer.push(event);
    if (state.buffer.length > RING_BUFFER_SIZE) {
      state.buffer.shift();
    }
    for (const sub of state.subscribers) {
      pushToSubscriber(sub, event);
    }
    return event;
  }

  subscribe(projectId: string, opts: SubscribeOptions = {}): AsyncIterable<RitualEvent> {
    const state = this.getOrCreate(projectId);
    return makeSubscription(state, opts);
  }

  private getOrCreate(projectId: string): ProjectState {
    let s = this.projects.get(projectId);
    if (!s) {
      s = { counter: BigInt(0), buffer: [], subscribers: new Set() };
      this.projects.set(projectId, s);
    }
    return s;
  }
}

function pushToSubscriber(sub: Subscriber, event: RitualEvent): void {
  if (sub.closed) return;
  if (sub.queue.length >= SUBSCRIBER_QUEUE_SIZE) {
    sub.queue.shift();
    // stream.gap is not in the public RitualEventType union (it's an internal
    // control marker). Cast for the comparison.
    if ((sub.queue[0]?.type as string | undefined) !== "stream.gap") {
      sub.queue.unshift(gapEvent(event.projectId, "subscriber backpressure overflow"));
    }
  }
  sub.queue.push(event);
  const wake = sub.wake;
  sub.wake = null;
  if (wake) wake();
}

function makeSubscription(
  state: ProjectState,
  opts: SubscribeOptions
): AsyncIterable<RitualEvent> {
  const sub: Subscriber = { queue: [], wake: null, closed: false };

  if (opts.sinceEventId !== undefined) {
    const cursorCounter = counterFromId(opts.sinceEventId);
    const idx = state.buffer.findIndex((e) => counterFromId(e.id) > cursorCounter);
    if (idx === -1) {
      // caught up — no replay
    } else {
      // Gap fires only when events have been evicted between the cursor and
      // the buffer's first replayable event — i.e., the first available
      // counter is more than one past the cursor.
      const firstCounter = counterFromId(state.buffer[idx]!.id);
      if (firstCounter > cursorCounter + BigInt(1)) {
        sub.queue.push(gapEvent(state.buffer[idx]!.projectId, "cursor older than ring buffer"));
      }
      for (let i = idx; i < state.buffer.length; i++) {
        sub.queue.push(state.buffer[i]!);
      }
    }
  } else {
    // First-connect subscribers (no Last-Event-ID) — Atlas's submit→redirect
    // pattern fires the ritual BEFORE the browser opens SSE, so any events
    // emitted during that gap would be lost on a strict "live-only" replay.
    // Replay the full ring buffer instead. The buffer is bounded
    // (RING_BUFFER_SIZE), so this is safe + cheap.
    for (const evt of state.buffer) {
      sub.queue.push(evt);
    }
  }

  state.subscribers.add(sub);
  const onAbort = () => {
    sub.closed = true;
    state.subscribers.delete(sub);
    const wake = sub.wake;
    sub.wake = null;
    if (wake) wake();
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<RitualEvent>> {
          while (!sub.closed) {
            const head = sub.queue.shift();
            if (head) return { value: head, done: false };
            await new Promise<void>((resolve) => {
              sub.wake = resolve;
            });
          }
          state.subscribers.delete(sub);
          return { value: undefined, done: true };
        },
        async return(): Promise<IteratorResult<RitualEvent>> {
          sub.closed = true;
          state.subscribers.delete(sub);
          return { value: undefined, done: true };
        }
      };
    }
  };
}

/** Extract the monotonic counter from a broker-assigned event id. ids have
 *  the form `${projectId}:${counter}` — buffer entries always carry a real
 *  counter (gap markers are never stored in the buffer, only synthesized
 *  into subscriber queues). */
function counterFromId(id: string): bigint {
  const colon = id.lastIndexOf(":");
  if (colon === -1) return BigInt(0);
  const tail = id.slice(colon + 1);
  // Defensive: if the tail isn't numeric (shouldn't happen for buffer ids),
  // treat it as 0 so we don't throw inside the iterator setup.
  return /^\d+$/.test(tail) ? BigInt(tail) : BigInt(0);
}

function gapEvent(projectId: string, reason: string): RitualEvent {
  return {
    id: `${projectId}:gap:${Date.now()}`,
    projectId,
    ritualId: "",
    type: "stream.gap" as never,
    payload: { reason },
    ts: Date.now()
  };
}
