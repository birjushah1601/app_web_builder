import { AuditEventSchema, type AuditEvent } from "./types.js";

export interface AuditSink {
  /** Append an event. Implementations are append-only; never accept updates or deletes. */
  append(event: AuditEvent): Promise<void>;
  /** Read events in time order. Filtering by projectId + action is required by the SOC 2 control. */
  query(filter: AuditQueryFilter): Promise<AuditEvent[]>;
}

export interface AuditQueryFilter {
  projectId: string;
  fromIso?: string;
  toIso?: string;
  actions?: string[];
}

/**
 * In-memory baseline sink — for tests + a working default. Production wires
 * a Postgres / S3 / Datadog backed sink.
 */
export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    const parsed = AuditEventSchema.parse(event);
    this.events.push(parsed);
  }

  async query(filter: AuditQueryFilter): Promise<AuditEvent[]> {
    const fromMs = filter.fromIso ? new Date(filter.fromIso).getTime() : -Infinity;
    const toMs = filter.toIso ? new Date(filter.toIso).getTime() : Infinity;
    const actionSet = filter.actions ? new Set(filter.actions) : null;
    return this.events
      .filter((e) => e.projectId === filter.projectId)
      .filter((e) => {
        const t = new Date(e.timestamp).getTime();
        return t >= fromMs && t <= toMs;
      })
      .filter((e) => (actionSet ? actionSet.has(e.action) : true))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  size(): number {
    return this.events.length;
  }
}
