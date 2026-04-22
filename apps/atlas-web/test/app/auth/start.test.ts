import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const baseEnv = (): Record<string, string> => ({
  KEYCLOAK_BASE_URL: "https://auth.atlas.app",
  KEYCLOAK_REALM: "atlas",
  KEYCLOAK_CLIENT_ID: "atlas-web",
  KEYCLOAK_REDIRECT_URI: "https://atlas.app/auth/callback"
});

async function loadRoute() {
  vi.resetModules();
  const mod = await import("@/app/auth/start/route.js");
  return mod.GET;
}

function req(): NextRequest {
  return new NextRequest("http://localhost/auth/start");
}

describe("/auth/start", () => {
  beforeEach(() => {
    Object.assign(process.env, baseEnv());
  });
  afterEach(() => {
    delete process.env.ATLAS_FF_AUTH_KEYCLOAK;
  });

  it("404s when the ATLAS_FF_AUTH_KEYCLOAK flag is off", async () => {
    delete process.env.ATLAS_FF_AUTH_KEYCLOAK;
    const GET = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("redirects to the Keycloak authorize URL with state + nonce + state/nonce cookies set", async () => {
    process.env.ATLAS_FF_AUTH_KEYCLOAK = "1";
    const GET = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(302);

    const location = res.headers.get("location")!;
    const locUrl = new URL(location);
    expect(locUrl.origin + locUrl.pathname).toBe(
      "https://auth.atlas.app/realms/atlas/protocol/openid-connect/auth"
    );
    expect(locUrl.searchParams.get("state")).toBeTruthy();
    expect(locUrl.searchParams.get("nonce")).toBeTruthy();
    expect(locUrl.searchParams.get("client_id")).toBe("atlas-web");

    // Cookies should match what's in the URL (same string — same request generated both).
    const setCookies = res.headers.getSetCookie();
    const stateCookie = setCookies.find((c) => c.startsWith("__atlas_oidc_state="));
    const nonceCookie = setCookies.find((c) => c.startsWith("__atlas_oidc_nonce="));
    expect(stateCookie).toBeDefined();
    expect(nonceCookie).toBeDefined();
    expect(stateCookie!.toLowerCase()).toContain("httponly");
    expect(nonceCookie!.toLowerCase()).toContain("httponly");
    expect(stateCookie!.toLowerCase()).toContain("samesite=lax");
  });

  it("500s when required Keycloak env is absent", async () => {
    process.env.ATLAS_FF_AUTH_KEYCLOAK = "1";
    delete process.env.KEYCLOAK_BASE_URL;
    const GET = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
