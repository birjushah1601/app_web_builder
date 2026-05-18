import { describe, it, expect } from "vitest";
import { ProviderError, NetworkError, RateLimitError, InvalidRequestError, isTransient } from "../src/errors.js";

describe("ProviderError hierarchy", () => {
  it("ProviderError is the base class", () => {
    const e = new ProviderError("boom", { transient: false });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ProviderError");
    expect(e.transient).toBe(false);
  });

  it("NetworkError is transient by default", () => {
    const e = new NetworkError("connection reset");
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.transient).toBe(true);
    expect(e.name).toBe("NetworkError");
  });

  it("RateLimitError is transient with retryAfter hint", () => {
    const e = new RateLimitError("too many", { retryAfterMs: 5000 });
    expect(e.transient).toBe(true);
    expect(e.retryAfterMs).toBe(5000);
  });

  it("InvalidRequestError is permanent", () => {
    const e = new InvalidRequestError("missing model");
    expect(e.transient).toBe(false);
  });

  it("isTransient distinguishes correctly", () => {
    expect(isTransient(new NetworkError("x"))).toBe(true);
    expect(isTransient(new RateLimitError("x"))).toBe(true);
    expect(isTransient(new InvalidRequestError("x"))).toBe(false);
    expect(isTransient(new Error("untyped"))).toBe(false);
  });
});
