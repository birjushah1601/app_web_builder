import { describe, it, expect } from "vitest";
import {
  deriveIdempotencyKey,
  freshNonce,
  InMemoryIdempotencyStore
} from "../src/idempotency.js";

describe("deriveIdempotencyKey", () => {
  const base = {
    merchantId: "m_1",
    customerId: "c_1",
    amountMinor: 1500,
    currency: "USD",
    nonce: "request-001"
  };

  it("returns the same key for the same input (idempotent)", () => {
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(base));
  });

  it("returns different keys for different amounts", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(
      deriveIdempotencyKey({ ...base, amountMinor: 1501 })
    );
  });

  it("returns different keys for different nonces", () => {
    expect(deriveIdempotencyKey(base)).not.toBe(
      deriveIdempotencyKey({ ...base, nonce: "request-002" })
    );
  });

  it("starts with idem_ prefix", () => {
    expect(deriveIdempotencyKey(base)).toMatch(/^idem_[0-9a-f]+$/);
  });
});

describe("freshNonce", () => {
  it("returns unique nonces on each call", () => {
    expect(freshNonce()).not.toBe(freshNonce());
  });
});

describe("InMemoryIdempotencyStore", () => {
  it("returns null for unseen keys", () => {
    const s = new InMemoryIdempotencyStore();
    expect(s.check("idem_x")).toBeNull();
  });

  it("returns recorded result on second check", () => {
    const s = new InMemoryIdempotencyStore();
    s.record("idem_x", { id: "ch_123" });
    expect(s.check("idem_x")).toEqual({ id: "ch_123" });
  });

  it("expires keys past TTL", () => {
    const s = new InMemoryIdempotencyStore({ ttlMs: 1000 });
    const t0 = new Date("2026-04-21T00:00:00.000Z");
    s.record("idem_x", { id: "ch_123" }, t0);
    const t1 = new Date("2026-04-21T00:00:02.000Z");
    expect(s.check("idem_x", t1)).toBeNull();
  });
});
