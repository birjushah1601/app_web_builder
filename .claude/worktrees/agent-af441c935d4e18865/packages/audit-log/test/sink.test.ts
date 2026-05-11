import { describe, it, expect } from "vitest";
import { InMemoryAuditSink } from "../src/sink.js";
import type { AuditEvent } from "../src/types.js";

const baseProject = "33333333-3333-4333-8333-333333333333";
const otherProject = "44444444-4444-4444-8444-444444444444";

const ev = (id: string, ts: string, action: AuditEvent["action"], projectId = baseProject): AuditEvent => ({
  id: `1111${id.padStart(4, "0")}-1111-7111-8111-111111111111`,
  timestamp: ts,
  actor: { kind: "user", id: "user_x" },
  action,
  outcome: "success",
  targetRef: "x",
  projectId,
  detail: {}
});

describe("InMemoryAuditSink", () => {
  it("appends events", async () => {
    const sink = new InMemoryAuditSink();
    await sink.append(ev("1", "2026-04-21T00:00:00.000Z", "auth.login"));
    expect(sink.size()).toBe(1);
  });

  it("query filters by projectId", async () => {
    const sink = new InMemoryAuditSink();
    await sink.append(ev("1", "2026-04-21T00:00:00.000Z", "auth.login"));
    await sink.append(ev("2", "2026-04-21T00:00:01.000Z", "auth.login", otherProject));
    const results = await sink.query({ projectId: baseProject });
    expect(results.length).toBe(1);
  });

  it("query filters by action set", async () => {
    const sink = new InMemoryAuditSink();
    await sink.append(ev("1", "2026-04-21T00:00:00.000Z", "auth.login"));
    await sink.append(ev("2", "2026-04-21T00:00:01.000Z", "deploy.succeeded"));
    const results = await sink.query({ projectId: baseProject, actions: ["deploy.succeeded"] });
    expect(results.length).toBe(1);
    expect(results[0]?.action).toBe("deploy.succeeded");
  });

  it("query filters by time range", async () => {
    const sink = new InMemoryAuditSink();
    await sink.append(ev("1", "2026-04-21T00:00:00.000Z", "auth.login"));
    await sink.append(ev("2", "2026-04-22T00:00:00.000Z", "auth.login"));
    await sink.append(ev("3", "2026-04-23T00:00:00.000Z", "auth.login"));
    const results = await sink.query({
      projectId: baseProject,
      fromIso: "2026-04-22T00:00:00.000Z",
      toIso: "2026-04-22T23:59:59.999Z"
    });
    expect(results.length).toBe(1);
  });

  it("query returns events in time order", async () => {
    const sink = new InMemoryAuditSink();
    await sink.append(ev("3", "2026-04-23T00:00:00.000Z", "auth.login"));
    await sink.append(ev("1", "2026-04-21T00:00:00.000Z", "auth.login"));
    await sink.append(ev("2", "2026-04-22T00:00:00.000Z", "auth.login"));
    const results = await sink.query({ projectId: baseProject });
    expect(results.map((e) => e.timestamp)).toEqual([
      "2026-04-21T00:00:00.000Z",
      "2026-04-22T00:00:00.000Z",
      "2026-04-23T00:00:00.000Z"
    ]);
  });
});
