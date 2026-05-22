import { describe, it, expect } from "vitest";
import { generateMigrationHints } from "../src/migration-hints.js";
import type { Entity } from "../src/types.js";

const base = (over: Partial<Entity> = {}): Entity => ({
  name: "post",
  description: "x",
  fields: [{ name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" }],
  primaryKey: { columns: ["id"], strategy: "uuid" },
  indexes: [],
  constraints: [],
  rls: { enabled: false, policies: [] },
  audit: { createdAt: true, updatedAt: true },
  migrationHints: [],
  ...over
});

describe("generateMigrationHints", () => {
  it("emits CONCURRENTLY hint for new index on a wide table (>5 fields)", () => {
    const e = base({
      fields: [
        { name: "id", type: "uuid", nullable: false },
        { name: "title", type: "text", nullable: false },
        { name: "body", type: "text", nullable: false },
        { name: "author_id", type: "uuid", nullable: false },
        { name: "tags", type: "jsonb", nullable: false },
        { name: "created_at", type: "timestamptz", nullable: false }
      ],
      indexes: [{ name: "post_author_id_idx", columns: ["author_id"] }]
    });
    const hints = generateMigrationHints(e);
    expect(hints.some((h) => /CONCURRENTLY/.test(h) && /post_author_id_idx/.test(h))).toBe(true);
  });

  it("emits CONCURRENTLY hint on any partitioned-table index", () => {
    const e = base({
      indexes: [{ name: "post_created_idx", columns: ["id"] }],
      partitioning: { kind: "range", on: "created_at" }
    });
    expect(generateMigrationHints(e).some((h) => /CONCURRENTLY/.test(h))).toBe(true);
  });

  it("emits staged-NOT-NULL hint for a NEW required column on a growth table", () => {
    const e = base({
      name: "user",
      fields: [
        { name: "id", type: "uuid", nullable: false },
        { name: "phone", type: "text", nullable: false }
      ]
    });
    expect(
      generateMigrationHints(e).some(
        (h) => /NOT NULL/i.test(h) && /backfill/i.test(h) && /phone/.test(h)
      )
    ).toBe(true);
  });

  it("emits pre-flight uniqueness hint for new unique indexes", () => {
    const e = base({
      indexes: [{ name: "post_slug_uniq", columns: ["id"], unique: true }]
    });
    expect(
      generateMigrationHints(e).some(
        (h) => /uniqueness/i.test(h) && /post_slug_uniq/.test(h)
      )
    ).toBe(true);
  });

  it("emits serial-to-bigint hint when PK strategy=serial on a growth table", () => {
    const e = base({
      name: "event",
      primaryKey: { columns: ["id"], strategy: "serial" }
    });
    expect(
      generateMigrationHints(e).some(
        (h) => /bigint/i.test(h) && /event/.test(h)
      )
    ).toBe(true);
  });
});
