import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, WebhookSignatureError } from "../src/webhook-signature.js";

const SECRET = "whsec_supersecret";
const PAYLOAD = '{"event":"payment.succeeded","id":"evt_1"}';

function signedHeader(payload: string, secret: string, ts: number): string {
  const signedPayload = `${ts}.${payload}`;
  const sig = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${ts},v1=${sig}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid fresh signature", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const ts = Math.floor(now.getTime() / 1000);
    const header = signedHeader(PAYLOAD, SECRET, ts);
    expect(() => verifyWebhookSignature(PAYLOAD, header, SECRET, {}, now)).not.toThrow();
  });

  it("rejects an expired signature", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const ts = Math.floor(now.getTime() / 1000) - 600; // 10 min old, default tolerance 5 min
    const header = signedHeader(PAYLOAD, SECRET, ts);
    expect(() => verifyWebhookSignature(PAYLOAD, header, SECRET, {}, now)).toThrow(
      WebhookSignatureError
    );
  });

  it("rejects a future-dated signature outside tolerance", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const ts = Math.floor(now.getTime() / 1000) + 600;
    const header = signedHeader(PAYLOAD, SECRET, ts);
    expect(() => verifyWebhookSignature(PAYLOAD, header, SECRET, {}, now)).toThrow(/future/);
  });

  it("rejects a tampered payload", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const ts = Math.floor(now.getTime() / 1000);
    const header = signedHeader(PAYLOAD, SECRET, ts);
    expect(() =>
      verifyWebhookSignature('{"event":"payment.failed"}', header, SECRET, {}, now)
    ).toThrow(/mismatch/);
  });

  it("rejects a wrong secret", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const ts = Math.floor(now.getTime() / 1000);
    const header = signedHeader(PAYLOAD, SECRET, ts);
    expect(() => verifyWebhookSignature(PAYLOAD, header, "whsec_wrong", {}, now)).toThrow(
      /mismatch/
    );
  });

  it("rejects missing v1 component", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const ts = Math.floor(now.getTime() / 1000);
    expect(() => verifyWebhookSignature(PAYLOAD, `t=${ts}`, SECRET, {}, now)).toThrow(/v1/);
  });

  it("rejects missing t component", () => {
    expect(() =>
      verifyWebhookSignature(PAYLOAD, "v1=deadbeef", SECRET, {}, new Date())
    ).toThrow(/timestamp/);
  });

  it("respects custom tolerance", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const ts = Math.floor(now.getTime() / 1000) - 600; // 10 min old
    const header = signedHeader(PAYLOAD, SECRET, ts);
    expect(() => verifyWebhookSignature(PAYLOAD, header, SECRET, { toleranceSec: 1200 }, now)).not.toThrow();
  });
});
