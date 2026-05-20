import { describe, expect, it } from "vitest";
import { parseManifest, MANIFEST_SCHEMA_VERSION, type Manifest } from "../src/offline/manifest.js";

describe("offline manifest", () => {
  const good: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: "2026-04-18T10:00:00.000Z",
    projectId: "11111111-1111-1111-1111-111111111111",
    tocoEntries: [
      { name: "spec_graph.json", sha256: "a".repeat(64), bytes: 100 },
      { name: "events.jsonl", sha256: "b".repeat(64), bytes: 200 },
      { name: "snapshots.jsonl", sha256: "c".repeat(64), bytes: 50 }
    ],
    archives: [
      { name: "archives/00000000000000000001-00000000000000000050.jsonl.gz", sha256: "d".repeat(64), bytes: 300 }
    ]
  };

  it("parses a valid manifest", () => {
    expect(parseManifest(good)).toEqual(good);
  });

  it("rejects an unknown schema version", () => {
    expect(() => parseManifest({ ...good, schemaVersion: 99 })).toThrow();
  });

  it("rejects a malformed sha256", () => {
    expect(() =>
      parseManifest({ ...good, tocoEntries: [{ ...good.tocoEntries[0]!, sha256: "nope" }] })
    ).toThrow();
  });

  it("rejects a non-UUID projectId", () => {
    expect(() => parseManifest({ ...good, projectId: "not-a-uuid" })).toThrow();
  });
});
