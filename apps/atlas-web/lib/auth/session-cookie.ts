import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Atlas session cookie. HttpOnly + Secure + SameSite=Lax + HMAC-SHA256
 * signed payload. Carries the minimum claims needed for `getCurrentUser()`
 * to reconstruct an AuthUser without a round-trip to Keycloak on every
 * request. Format: `<base64url(json)>.<base64url(hmac)>`.
 *
 * The ID token itself is not stored (too large, leaks claims). The refresh
 * token IS stored so the session can mint fresh access tokens when the
 * short-lived ones expire.
 */
export const ATLAS_SESSION_COOKIE = "__atlas_session";

export interface SessionClaims {
  sub: string;
  email?: string;
  name?: string;
  refreshToken?: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

export interface SealOptions {
  /** 32-byte secret from env. */
  secret: string;
  /** Seconds until cookie expiry. Default 30 days. */
  maxAgeSec?: number;
}

export class SessionSealError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionSealError";
  }
}

export async function sealSession(
  claims: Omit<SessionClaims, "iat" | "exp">,
  opts: SealOptions
): Promise<string> {
  if (!opts.secret || opts.secret.length < 32) {
    throw new SessionSealError("ATLAS_SESSION_SECRET must be at least 32 chars");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + (opts.maxAgeSec ?? 30 * 24 * 60 * 60);
  const payload: SessionClaims = { ...claims, iat: nowSec, exp: expSec };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64url(Buffer.from(payloadJson, "utf8"));
  const sig = createHmac("sha256", opts.secret).update(payloadB64).digest();
  const sigB64 = base64url(sig);
  return `${payloadB64}.${sigB64}`;
}

export async function unsealSession(
  token: string,
  opts: { secret: string }
): Promise<SessionClaims> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new SessionSealError("malformed session cookie");
  }
  const [payloadB64, sigB64] = parts as [string, string];
  const expected = createHmac("sha256", opts.secret).update(payloadB64).digest();
  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    throw new SessionSealError("session signature decode failed");
  }
  if (providedSig.length !== expected.length || !timingSafeEqual(providedSig, expected)) {
    throw new SessionSealError("session signature mismatch");
  }
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionClaims;
  } catch (err) {
    throw new SessionSealError("session payload JSON invalid", { cause: err });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < nowSec) {
    throw new SessionSealError("session expired");
  }
  return claims;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}
