import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookSignatureOptions {
  /** Maximum age (seconds) accepted between signature timestamp and `now`. Default 5 minutes. */
  toleranceSec?: number;
}

export class WebhookSignatureError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`WebhookSignatureError: ${reason}`);
    this.name = "WebhookSignatureError";
    this.reason = reason;
  }
}

/**
 * Verify a Stripe-style webhook signature header (the same shape Paystack and
 * Razorpay also use): `t=<unix-seconds>,v1=<hex-hmac-sha256>`.
 * Throws WebhookSignatureError on any failure mode (bad format, expired, or
 * signature mismatch). Uses timingSafeEqual to defeat timing oracles.
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  options: WebhookSignatureOptions = {},
  now: Date = new Date()
): void {
  const tolerance = options.toleranceSec ?? 300;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t" && v) timestamp = Number.parseInt(v, 10);
    else if (k === "v1" && v) signatures.push(v);
  }
  if (timestamp === null || Number.isNaN(timestamp)) {
    throw new WebhookSignatureError("missing or malformed t= timestamp");
  }
  if (signatures.length === 0) {
    throw new WebhookSignatureError("missing v1= signature");
  }
  const ageSec = Math.floor(now.getTime() / 1000) - timestamp;
  if (ageSec > tolerance) {
    throw new WebhookSignatureError(`expired (age ${ageSec}s > tolerance ${tolerance}s)`);
  }
  if (ageSec < -tolerance) {
    throw new WebhookSignatureError(`timestamp from the future (age ${ageSec}s)`);
  }
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  for (const sig of signatures) {
    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(sig, "hex");
    } catch {
      continue;
    }
    if (sigBytes.length !== expectedBytes.length) continue;
    if (timingSafeEqual(expectedBytes, sigBytes)) return;
  }
  throw new WebhookSignatureError("signature mismatch");
}
