import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Stub the KeycloakAuthProvider so the callback route's code exchange runs
// without a network. keycloakFromEnv reads env synchronously at call time,
// so we mock the class + construct path.
const completeCodeFlowMock = vi.fn();
vi.mock("@atlas/auth-keycloak", () => ({
  KeycloakAuthProvider: class {
    constructor() {}
    completeCodeFlow = completeCodeFlowMock;
    getAuthorizeUrl() {
      return "";
    }
  }
}));

const baseEnv = (): Record<string, string> => ({
  KEYCLOAK_BASE_URL: "https://auth.atlas.app",
  KEYCLOAK_REALM: "atlas",
  KEYCLOAK_CLIENT_ID: "atlas-web",
  KEYCLOAK_REDIRECT_URI: "https://atlas.app/auth/callback",
  ATLAS_SESSION_SECRET: "a".repeat(32),
  ATLAS_FF_AUTH_KEYCLOAK: "1"
});

async function loadRoute() {
  vi.resetModules();
  const mod = await import("@/app/auth/callback/route");
  return mod.GET;
}

function reqWithCookies(
  url: string,
  cookies: Record<string, string> = {}
): NextRequest {
  const req = new NextRequest(url);
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("/auth/callback", () => {
  beforeEach(() => {
    Object.assign(process.env, baseEnv());
    completeCodeFlowMock.mockReset();
  });

  afterEach(() => {
    delete process.env.ATLAS_FF_AUTH_KEYCLOAK;
    delete process.env.ATLAS_SESSION_SECRET;
  });

  it("404s when flag is off", async () => {
    delete process.env.ATLAS_FF_AUTH_KEYCLOAK;
    const GET = await loadRoute();
    const res = await GET(reqWithCookies("http://localhost/auth/callback?code=c&state=s"));
    expect(res.status).toBe(404);
  });

  it("400s when code or state is missing", async () => {
    const GET = await loadRoute();
    const res = await GET(reqWithCookies("http://localhost/auth/callback"));
    expect(res.status).toBe(400);
  });

  it("400s when the state cookie does not match the state query param", async () => {
    const GET = await loadRoute();
    const res = await GET(
      reqWithCookies("http://localhost/auth/callback?code=c&state=NEW", {
        __atlas_oidc_state: "DIFFERENT"
      })
    );
    expect(res.status).toBe(400);
  });

  it("500s when ATLAS_SESSION_SECRET is missing", async () => {
    delete process.env.ATLAS_SESSION_SECRET;
    const GET = await loadRoute();
    const res = await GET(
      reqWithCookies("http://localhost/auth/callback?code=c&state=s", {
        __atlas_oidc_state: "s"
      })
    );
    expect(res.status).toBe(500);
  });

  it("502s when completeCodeFlow throws", async () => {
    completeCodeFlowMock.mockRejectedValueOnce(new Error("keycloak down"));
    const GET = await loadRoute();
    const res = await GET(
      reqWithCookies("http://localhost/auth/callback?code=c&state=s", {
        __atlas_oidc_state: "s"
      })
    );
    expect(res.status).toBe(502);
  });

  it("on success, sets the session cookie, clears transit cookies, and redirects to /", async () => {
    completeCodeFlowMock.mockResolvedValueOnce({
      subjectId: "kc_user_1",
      email: "u@atlas.app",
      name: "U",
      accessToken: "at",
      idToken: "it",
      refreshToken: "rt",
      expiresAtMs: Date.now() + 300_000,
      claims: { sub: "kc_user_1" }
    });
    const GET = await loadRoute();
    const res = await GET(
      reqWithCookies("http://localhost/auth/callback?code=c&state=s", {
        __atlas_oidc_state: "s"
      })
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");

    const setCookies = res.headers.getSetCookie();
    const session = setCookies.find((c) => c.startsWith("__atlas_session="));
    expect(session).toBeDefined();
    expect(session!.toLowerCase()).toContain("httponly");
    expect(session!.toLowerCase()).toContain("samesite=lax");

    const stateCleared = setCookies.some(
      (c) => c.startsWith("__atlas_oidc_state=") && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(c)
    );
    const nonceCleared = setCookies.some(
      (c) => c.startsWith("__atlas_oidc_nonce=") && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(c)
    );
    expect(stateCleared).toBe(true);
    expect(nonceCleared).toBe(true);
  });

  it("honors same-origin return_to query param", async () => {
    completeCodeFlowMock.mockResolvedValueOnce({
      subjectId: "u",
      email: undefined,
      name: undefined,
      accessToken: "at",
      idToken: "it",
      refreshToken: undefined,
      expiresAtMs: Date.now() + 300_000,
      claims: { sub: "u" }
    });
    const GET = await loadRoute();
    const res = await GET(
      reqWithCookies(
        "http://localhost/auth/callback?code=c&state=s&return_to=/projects/abc/canvas",
        { __atlas_oidc_state: "s" }
      )
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/projects/abc/canvas");
  });

  it("ignores cross-origin return_to and falls back to /", async () => {
    completeCodeFlowMock.mockResolvedValueOnce({
      subjectId: "u",
      email: undefined,
      name: undefined,
      accessToken: "at",
      idToken: "it",
      refreshToken: undefined,
      expiresAtMs: Date.now() + 300_000,
      claims: { sub: "u" }
    });
    const GET = await loadRoute();
    const res = await GET(
      reqWithCookies(
        "http://localhost/auth/callback?code=c&state=s&return_to=https://evil.com/x",
        { __atlas_oidc_state: "s" }
      )
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");
  });
});
