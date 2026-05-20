import { describe, it, expect } from "vitest";
import { AuditEventSchema } from "../src/types.js";

const validEvent = {
  id: "11111111-1111-7111-8111-111111111111",
  timestamp: "2026-04-21T12:00:00.000Z",
  actor: { kind: "user" as const, id: "user_abc", display: "Ama" },
  action: "ritual.approved" as const,
  outcome: "success" as const,
  targetRef: "ritual:r1",
  projectId: "22222222-2222-4222-8222-222222222222",
  detail: {}
};

describe("AuditEventSchema", () => {
  it("accepts a valid event", () => {
    expect(AuditEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it("rejects unknown action", () => {
    expect(
      AuditEventSchema.safeParse({ ...validEvent, action: "made-up.action" }).success
    ).toBe(false);
  });

  it("rejects missing projectId (tenant scope is mandatory)", () => {
    const bad = { ...validEvent } as Record<string, unknown>;
    delete bad.projectId;
    expect(AuditEventSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects projectId that is not a UUID", () => {
    expect(
      AuditEventSchema.safeParse({ ...validEvent, projectId: "not-uuid" }).success
    ).toBe(false);
  });

  it("rejects unknown extra fields (strict)", () => {
    expect(
      AuditEventSchema.safeParse({ ...validEvent, somethingElse: "x" }).success
    ).toBe(false);
  });
});
