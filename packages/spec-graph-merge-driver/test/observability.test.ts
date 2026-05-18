import { beforeEach, describe, expect, it } from "vitest";
import {
  mergeInvocations,
  mergeDuration,
  mirrorUnreachable,
  registry,
  withMergeSpan
} from "../src/observability.js";

describe("observability: merge-driver metrics", () => {
  beforeEach(() => {
    registry.resetMetrics();
  });

  it("exposes the three metric series with the agreed names", async () => {
    const text = await registry.metrics();
    expect(text).toContain("atlas_merge_driver_invocations_total");
    expect(text).toContain("atlas_merge_driver_duration_seconds");
    expect(text).toContain("atlas_merge_driver_mirror_unreachable_total");
  });

  it("increments invocations_total with {pattern,path,result}", async () => {
    mergeInvocations.inc({ pattern: "events.jsonl", path: ".atlas/events.jsonl", result: "ok" });
    const text = await registry.metrics();
    expect(text).toMatch(
      /atlas_merge_driver_invocations_total\{pattern="events\.jsonl",path="\.atlas\/events\.jsonl",result="ok"\} 1/
    );
  });

  it("observes a duration on the histogram", async () => {
    mergeDuration.observe({ pattern: "events.jsonl" }, 0.017);
    const text = await registry.metrics();
    expect(text).toMatch(/atlas_merge_driver_duration_seconds_count\{pattern="events\.jsonl"\} 1/);
  });

  it("increments mirror_unreachable_total as a zero-label counter", async () => {
    mirrorUnreachable.inc();
    const text = await registry.metrics();
    expect(text).toMatch(/atlas_merge_driver_mirror_unreachable_total 1/);
  });

  it("withMergeSpan emits ok result on success", async () => {
    await withMergeSpan(
      { pattern: "events.jsonl", path: ".atlas/events.jsonl" },
      async () => "done"
    );
    const text = await registry.metrics();
    expect(text).toMatch(/result="ok"/);
  });

  it("withMergeSpan emits conflict result when fn throws an Error tagged 'conflict'", async () => {
    const err = Object.assign(new Error("3-way failed"), { atlasResult: "conflict" as const });
    await expect(
      withMergeSpan({ pattern: "spec.graph.json", path: ".atlas/spec.graph.json" }, async () => {
        throw err;
      })
    ).rejects.toThrow("3-way failed");
    const text = await registry.metrics();
    expect(text).toMatch(/result="conflict"/);
  });
});
