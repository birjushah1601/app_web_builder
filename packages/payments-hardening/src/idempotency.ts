import { createHash, randomUUID } from "node:crypto";

/**
 * Generate a stable idempotency key for a payment intent. The key is derived
 * from the merchant + customer + amount + currency + a tenant-supplied nonce
 * so retries of the same logical request produce the same key, but different
 * logical requests don't collide.
 */
export interface IdempotencyKeyInput {
  merchantId: string;
  customerId: string;
  /** Amount in the smallest currency unit (cents, paise, etc.). */
  amountMinor: number;
  currency: string;
  /** Caller-controlled nonce. Same nonce = same idempotency key = same payment intent. */
  nonce: string;
}

export function deriveIdempotencyKey(input: IdempotencyKeyInput): string {
  const payload = [
    input.merchantId,
    input.customerId,
    String(input.amountMinor),
    input.currency,
    input.nonce
  ].join("|");
  const hash = createHash("sha256").update(payload).digest("hex");
  return `idem_${hash.slice(0, 32)}`;
}

/** Generate a fresh nonce when the caller has no stable identifier of its own. */
export function freshNonce(): string {
  return randomUUID();
}

/**
 * In-memory idempotency store — for tests + a baseline implementation.
 * Production wires a Redis or Postgres-backed store with TTL semantics.
 */
export class InMemoryIdempotencyStore {
  private readonly seen = new Map<string, { firstSeen: Date; result: unknown }>();
  private readonly ttlMs: number;

  constructor(opts: { ttlMs?: number } = {}) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  }

  /** Returns the prior result if the key was seen within TTL; otherwise null. */
  check(key: string, now: Date = new Date()): unknown | null {
    const hit = this.seen.get(key);
    if (!hit) return null;
    if (now.getTime() - hit.firstSeen.getTime() > this.ttlMs) {
      this.seen.delete(key);
      return null;
    }
    return hit.result;
  }

  /** Store the result under the key. Subsequent `check()` calls return this. */
  record(key: string, result: unknown, now: Date = new Date()): void {
    this.seen.set(key, { firstSeen: now, result });
  }

  size(): number {
    return this.seen.size;
  }
}
