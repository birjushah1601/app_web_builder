import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { keycloakFromEnv } from "@/lib/auth/keycloak-factory";
import {
  STATE_COOKIE,
  NONCE_COOKIE,
  OIDC_TRANSIT_COOKIE_OPTIONS
} from "@/lib/auth/oidc-cookies";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  if (!isFeatureEnabled("auth-keycloak")) {
    return NextResponse.json({ error: "Keycloak auth not enabled" }, { status: 404 });
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

  const state = randomUUID();
  const nonce = randomUUID();
  const url = provider.getAuthorizeUrl({ state, nonce });

  const res = NextResponse.redirect(url, 302);
  const cookieOpts = {
    ...OIDC_TRANSIT_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === "production"
  };
  res.cookies.set(STATE_COOKIE, state, cookieOpts);
  res.cookies.set(NONCE_COOKIE, nonce, cookieOpts);
  return res;
}
