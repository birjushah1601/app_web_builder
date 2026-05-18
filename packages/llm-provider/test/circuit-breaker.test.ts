import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../src/circuit-breaker.js";
import { NetworkError } from "../src/errors.js";

describe("CircuitBreaker", () => {
  it("starts closed and allows calls through", async () => {
    const cb = new CircuitBreaker({ key: "anthropic:sonnet-4-6", openAfter: 5, halfOpenAfterMs: 30_000 });
    const result = await cb.run(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.state).toBe("closed");
  });

  it("opens after 5 consecutive failures", async () => {
    const cb = new CircuitBreaker({ key: "k", openAfter: 5, halfOpenAfterMs: 30_000 });
    for (let i = 0; i < 5; i++) {
      await expect(cb.run(async () => { throw new NetworkError("boom"); })).rejects.toThrow(NetworkError);
    }
    expect(cb.state).toBe("open");
    await expect(cb.run(async () => "should-not-run")).rejects.toThrow(CircuitOpenError);
  });

  it("half-opens after halfOpenAfterMs", async () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker({ key: "k", openAfter: 2, halfOpenAfterMs: 30_000, clock });
    await expect(cb.run(async () => { throw new NetworkError("f1"); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new NetworkError("f2"); })).rejects.toThrow();
    expect(cb.state).toBe("open");
    now += 31_000;
    expect(cb.state).toBe("half-open");
  });

  it("closes on first success after half-open", async () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker({ key: "k", openAfter: 2, halfOpenAfterMs: 30_000, clock });
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    now += 31_000;
    const result = await cb.run(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.state).toBe("closed");
  });

  it("reopens immediately on half-open failure", async () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker({ key: "k", openAfter: 2, halfOpenAfterMs: 30_000, clock });
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    now += 31_000;
    await expect(cb.run(async () => { throw new NetworkError("still"); })).rejects.toThrow();
    expect(cb.state).toBe("open");
  });
});
