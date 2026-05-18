import { describe, it, expect, vi } from "vitest";
import { retry, DEFAULT_RETRY_POLICY, NO_RETRY_POLICY } from "../src/retry.js";
import { NetworkError, InvalidRequestError } from "../src/errors.js";

describe("retry wrapper", () => {
  it("returns on first success", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await retry(fn, DEFAULT_RETRY_POLICY);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error up to max attempts", async () => {
    let count = 0;
    const fn = vi.fn(async () => {
      count++;
      if (count < 3) throw new NetworkError("transient");
      return "ok";
    });
    const result = await retry(fn, DEFAULT_RETRY_POLICY, { sleep: async () => {} });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn(async () => { throw new NetworkError("always"); });
    await expect(retry(fn, DEFAULT_RETRY_POLICY, { sleep: async () => {} }))
      .rejects.toThrow(NetworkError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on permanent errors", async () => {
    const fn = vi.fn(async () => { throw new InvalidRequestError("bad"); });
    await expect(retry(fn, DEFAULT_RETRY_POLICY, { sleep: async () => {} }))
      .rejects.toThrow(InvalidRequestError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("NO_RETRY_POLICY calls fn exactly once even on transient errors", async () => {
    const fn = vi.fn(async () => { throw new NetworkError("transient"); });
    await expect(retry(fn, NO_RETRY_POLICY)).rejects.toThrow(NetworkError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backoff doubles between attempts", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    let count = 0;
    const fn = async () => {
      count++;
      if (count < 3) throw new NetworkError("transient");
      return "ok";
    };
    await retry(fn, DEFAULT_RETRY_POLICY, { sleep });
    expect(delays).toEqual([100, 400]); // 100, 400 (next would be 1600 but third attempt succeeds)
  });
});
