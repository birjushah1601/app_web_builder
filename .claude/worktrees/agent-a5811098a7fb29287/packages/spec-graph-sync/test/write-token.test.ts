import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WriteTokenRegistry } from "../src/write-token.js";

describe("WriteTokenRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers a token and reports it as recent", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    registry.register("file-a", "hash-123");
    expect(registry.wasWrittenByUs("file-a", "hash-123")).toBe(true);
  });

  it("returns false for an unknown file/hash pair", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    expect(registry.wasWrittenByUs("file-a", "hash-xyz")).toBe(false);
  });

  it("distinguishes tokens by file path", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    registry.register("file-a", "hash-123");
    expect(registry.wasWrittenByUs("file-b", "hash-123")).toBe(false);
  });

  it("expires tokens after the TTL window", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 1_000 });
    registry.register("file-a", "hash-123");
    vi.advanceTimersByTime(1_100);
    registry.gc();
    expect(registry.wasWrittenByUs("file-a", "hash-123")).toBe(false);
  });

  it("gc() is idempotent and safe on empty registries", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 1_000 });
    expect(() => registry.gc()).not.toThrow();
    expect(() => registry.gc()).not.toThrow();
  });

  it("holds multiple tokens for the same file (rapid successive writes)", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    registry.register("file-a", "hash-1");
    registry.register("file-a", "hash-2");
    expect(registry.wasWrittenByUs("file-a", "hash-1")).toBe(true);
    expect(registry.wasWrittenByUs("file-a", "hash-2")).toBe(true);
  });
});
