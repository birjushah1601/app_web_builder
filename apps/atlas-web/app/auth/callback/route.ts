import { NextResponse, type NextRequest } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags.js";
import { keycloakFromEnv } from "@/lib/auth/keycloak-factory.js";
import { ATLAS_SESSION_COOKIE, sealSession } from "@/lib/auth/session-cookie.js";
import { STATE_COOKIE, NONCE_COOKIE } from "@/lib/auth/oidc-cookies.js";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isFeatureEnabled("auth-keycloak")) {
    return NextResponse.json({ error: "Keycloak auth not enabled" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return NextResponse.json({ error: "missing code or state" }, { status: 400 });
  }

  const storedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.json({ error: "state mismatch" }, { status: 400 });
  }

  const sessionSecret = process.env.ATLAS_SESSION_SECRET;
  if (!sessionSecret) {
    return NextResponse.json(
      { error: "ATLAS_SESSION_SECRET not configured" },
      { status: 500 }
    );
  }

  let provider;
  try {
    provider = keycloakFromEnv();
  } catch (err) {
    return NextResponse.json(
      { error: `Keycloak configuration error: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  let session;
  try {
    session = await provider.completeCodeFlow({ code });
  } catch (err) {
    return NextResponse.json(
      { error: `code exchange failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const sealed = await sealSession(
    {
      sub: session.subjectId,
      email: session.email,
      name: session.name,
      refreshToken: session.refreshToken
    },
    { secret: sessionSecret }
  );

  // Honor ?return_to if it's same-origin; otherwise default to /.
  const returnTo = validatedReturnTo(searchParams.get("return_to"), req.url) ?? "/";
  const res = NextResponse.redirect(new URL(returnTo, req.url), 302);
  res.cookies.set(ATLAS_SESSION_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60
  });
  // Clear the short-lived transit cookies.
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(NONCE_COOKIE);
  return res;
}

function validatedReturnTo(candidate: string | null, requestUrl: string): string | null {
  if (!candidate) return null;
  try {
    const u = new URL(candidate, requestUrl);
    const origin = new URL(requestUrl).origin;
    if (u.origin !== origin) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}
