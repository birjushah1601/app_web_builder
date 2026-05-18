import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeycloakAuthProvider } from "../src/provider.js";
import { IdTokenVerificationError, TokenExchangeError } from "../src/errors.js";
import type { JwtClaims, JwtVerifier } from "../src/types.js";

const BASE = "https://auth.atlas.app";
const REALM = "atlas";
const CLIENT = "atlas-web";
const REDIRECT = "https://atlas.app/auth/callback";

function goodClaims(): JwtClaims {
  return {
    sub: "user-123",
    email: "user@atlas.app",
    email_verified: true,
    name: "Atlas User",
    preferred_username: "atlas-user",
    iss: `${BASE}/realms/${REALM}`,
    aud: CLIENT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };
}

function mockFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body
  })) as unknown as typeof fetch;
}

function mockFetch500(): typeof fetch {
  return vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
}

const goodVerifier: JwtVerifier = async () => goodClaims();
const badVerifier: JwtVerifier = async () => {
  throw new Error("signature fail");
};

describe("KeycloakAuthProvider endpoint derivation", () => {
  const provider = new KeycloakAuthProvider({
    baseUrl: BASE,
    realm: REALM,
    clientId: CLIENT,
    redirectUri: REDIRECT,
    fetchFn: mockFetchOk({}),
    verifyIdTokenFn: goodVerifier
  });

  it("issuerUrl is {baseUrl}/realms/{realm}", () => {
    expect(provider.issuerUrl()).toBe(`${BASE}/realms/${REALM}`);
  });
  it("authorizeEndpoint is issuer + /protocol/openid-connect/auth", () => {
    expect(provider.authorizeEndpoint()).toBe(`${BASE}/realms/${REALM}/protocol/openid-connect/auth`);
  });
  it("tokenEndpoint is issuer + /protocol/openid-connect/token", () => {
    expect(provider.tokenEndpoint()).toBe(`${BASE}/realms/${REALM}/protocol/openid-connect/token`);
  });
  it("jwksUri is issuer + /protocol/openid-connect/certs", () => {
    expect(provider.jwksUri()).toBe(`${BASE}/realms/${REALM}/protocol/openid-connect/certs`);
  });
});

describe("KeycloakAuthProvider.getAuthorizeUrl", () => {
  const p = new KeycloakAuthProvider({
    baseUrl: BASE,
    realm: REALM,
    clientId: CLIENT,
    redirectUri: REDIRECT,
    fetchFn: mockFetchOk({}),
    verifyIdTokenFn: goodVerifier
  });

  it("includes OIDC query params", () => {
    const u = new URL(p.getAuthorizeUrl({ state: "s1", nonce: "n1" }));
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe(CLIENT);
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(u.searchParams.get("state")).toBe("s1");
    expect(u.searchParams.get("nonce")).toBe("n1");
    expect(u.searchParams.get("scope")).toContain("openid");
    expect(u.searchParams.get("scope")).toContain("email");
  });

  it("includes PKCE parameters when codeChallenge provided", () => {
    const u = new URL(
      p.getAuthorizeUrl({
        state: "s",
        nonce: "n",
        codeChallenge: "abc",
        codeChallengeMethod: "S256"
      })
    );
    expect(u.searchParams.get("code_challenge")).toBe("abc");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("appends extra scopes", () => {
    const p2 = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      extraScopes: ["offline_access"],
      fetchFn: mockFetchOk({}),
      verifyIdTokenFn: goodVerifier
    });
    const u = new URL(p2.getAuthorizeUrl({ state: "s", nonce: "n" }));
    expect(u.searchParams.get("scope")).toContain("offline_access");
  });
});

describe("KeycloakAuthProvider.exchangeCodeForTokens", () => {
  let fetchFn: typeof fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const body = {
      access_token: "at",
      id_token: "it",
      refresh_token: "rt",
      expires_in: 300,
      token_type: "Bearer"
    };
    fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body
    }));
    fetchFn = fetchSpy as unknown as typeof fetch;
  });

  it("posts form-encoded body to token endpoint", async () => {
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      clientSecret: "cs",
      redirectUri: REDIRECT,
      fetchFn,
      verifyIdTokenFn: goodVerifier
    });
    await p.exchangeCodeForTokens({ code: "abc", codeVerifier: "v" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(p.tokenEndpoint());
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded"
    });
    const sent = new URLSearchParams(init?.body as string);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("abc");
    expect(sent.get("code_verifier")).toBe("v");
    expect(sent.get("client_secret")).toBe("cs");
  });

  it("omits client_secret for public clients", async () => {
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      fetchFn,
      verifyIdTokenFn: goodVerifier
    });
    await p.exchangeCodeForTokens({ code: "abc" });
    const sent = new URLSearchParams(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(sent.has("client_secret")).toBe(false);
  });

  it("throws TokenExchangeError on non-2xx", async () => {
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      fetchFn: mockFetch500(),
      verifyIdTokenFn: goodVerifier
    });
    await expect(p.exchangeCodeForTokens({ code: "abc" })).rejects.toThrow(TokenExchangeError);
  });

  it("throws TokenExchangeError on malformed body", async () => {
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      fetchFn: mockFetchOk({ missing_tokens: true }),
      verifyIdTokenFn: goodVerifier
    });
    await expect(p.exchangeCodeForTokens({ code: "abc" })).rejects.toThrow(TokenExchangeError);
  });
});

describe("KeycloakAuthProvider.refreshTokens", () => {
  it("sets grant_type=refresh_token + refresh_token body param", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "a",
        id_token: "i",
        refresh_token: "new-rt",
        expires_in: 300,
        token_type: "Bearer"
      })
    }));
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      fetchFn: fetchSpy as unknown as typeof fetch,
      verifyIdTokenFn: goodVerifier
    });
    await p.refreshTokens("old-rt");
    const sent = new URLSearchParams(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("old-rt");
  });
});

describe("KeycloakAuthProvider.completeCodeFlow", () => {
  const tokenBody = {
    access_token: "at",
    id_token: "it",
    refresh_token: "rt",
    expires_in: 300,
    token_type: "Bearer"
  };

  it("returns AuthSession with claims on success", async () => {
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      fetchFn: mockFetchOk(tokenBody),
      verifyIdTokenFn: goodVerifier
    });
    const session = await p.completeCodeFlow({ code: "abc" });
    expect(session.subjectId).toBe("user-123");
    expect(session.email).toBe("user@atlas.app");
    expect(session.accessToken).toBe("at");
    expect(session.refreshToken).toBe("rt");
    expect(session.expiresAtMs).toBeGreaterThan(Date.now());
    expect(session.claims.iss).toBe(`${BASE}/realms/${REALM}`);
  });

  it("throws IdTokenVerificationError when verifier rejects", async () => {
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      fetchFn: mockFetchOk(tokenBody),
      verifyIdTokenFn: badVerifier
    });
    await expect(p.completeCodeFlow({ code: "abc" })).rejects.toThrow(IdTokenVerificationError);
  });

  it("passes issuer + audience + jwksUri to verifier", async () => {
    const verifySpy = vi.fn(async () => goodClaims()) as JwtVerifier;
    const p = new KeycloakAuthProvider({
      baseUrl: BASE,
      realm: REALM,
      clientId: CLIENT,
      redirectUri: REDIRECT,
      fetchFn: mockFetchOk(tokenBody),
      verifyIdTokenFn: verifySpy
    });
    await p.completeCodeFlow({ code: "abc" });
    const args = (verifySpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(args[1]).toMatchObject({
      issuer: `${BASE}/realms/${REALM}`,
      audience: CLIENT,
      jwksUri: `${BASE}/realms/${REALM}/protocol/openid-connect/certs`
    });
  });
});
