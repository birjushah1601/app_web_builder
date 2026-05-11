import { jwtVerify, createRemoteJWKSet } from "jose";
import {
  JwtClaimsSchema,
  TokenResponseSchema,
  type AuthSession,
  type AuthorizeUrlInput,
  type ExchangeCodeInput,
  type JwtClaims,
  type JwtVerifier,
  type KeycloakConfig,
  type TokenResponse
} from "./types.js";
import { IdTokenVerificationError, TokenExchangeError } from "./errors.js";

export class KeycloakAuthProvider {
  private readonly fetchFn: typeof fetch;
  private readonly verifyIdToken: JwtVerifier;

  constructor(private readonly config: KeycloakConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.verifyIdToken = config.verifyIdTokenFn ?? defaultJoseVerifier;
  }

  issuerUrl(): string {
    return `${this.config.baseUrl}/realms/${this.config.realm}`;
  }

  authorizeEndpoint(): string {
    return `${this.issuerUrl()}/protocol/openid-connect/auth`;
  }

  tokenEndpoint(): string {
    return `${this.issuerUrl()}/protocol/openid-connect/token`;
  }

  jwksUri(): string {
    return `${this.issuerUrl()}/protocol/openid-connect/certs`;
  }

  /** Build the URL to redirect the user to for authentication. */
  getAuthorizeUrl(input: AuthorizeUrlInput): string {
    const url = new URL(this.authorizeEndpoint());
    const scopes = ["openid", "profile", "email", ...(this.config.extraScopes ?? [])];
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    if (input.codeChallenge) {
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", input.codeChallengeMethod ?? "S256");
    }
    return url.toString();
  }

  /** Exchange an authorization code for id/access/refresh tokens. */
  async exchangeCodeForTokens(input: ExchangeCodeInput): Promise<TokenResponse> {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", input.code);
    body.set("redirect_uri", this.config.redirectUri);
    body.set("client_id", this.config.clientId);
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);
    if (input.codeVerifier) body.set("code_verifier", input.codeVerifier);
    return this.tokenRequest(body);
  }

  async refreshTokens(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.set("client_id", this.config.clientId);
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);
    return this.tokenRequest(body);
  }

  /** Full code-to-session flow: exchange code, verify id_token, return AuthSession. */
  async completeCodeFlow(input: ExchangeCodeInput): Promise<AuthSession> {
    const tokens = await this.exchangeCodeForTokens(input);
    const claims = await this.verifyAndParseIdToken(tokens.id_token);
    return this.buildSession(tokens, claims);
  }

  private async verifyAndParseIdToken(idToken: string): Promise<JwtClaims> {
    let raw: JwtClaims;
    try {
      raw = await this.verifyIdToken(idToken, {
        issuer: this.issuerUrl(),
        audience: this.config.clientId,
        jwksUri: this.jwksUri()
      });
    } catch (err) {
      throw new IdTokenVerificationError("id_token signature or claims invalid", { cause: err });
    }
    const parsed = JwtClaimsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new IdTokenVerificationError(
        `id_token claims failed schema: ${JSON.stringify(parsed.error.issues)}`
      );
    }
    return parsed.data;
  }

  private buildSession(tokens: TokenResponse, claims: JwtClaims): AuthSession {
    return {
      subjectId: claims.sub,
      email: claims.email,
      name: claims.name ?? claims.preferred_username,
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token,
      expiresAtMs: Date.now() + tokens.expires_in * 1000,
      claims
    };
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
    const res = await this.fetchFn(this.tokenEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString()
    });
    if (!res.ok) {
      throw new TokenExchangeError(
        `Keycloak token endpoint returned HTTP ${res.status}`
      );
    }
    const parsed = TokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new TokenExchangeError(
        `Keycloak token response failed schema: ${JSON.stringify(parsed.error.issues)}`
      );
    }
    return parsed.data;
  }
}

const defaultJoseVerifier: JwtVerifier = async (idToken, opts) => {
  const JWKS = createRemoteJWKSet(new URL(opts.jwksUri));
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: opts.issuer,
    audience: opts.audience
  });
  return payload as JwtClaims;
};
