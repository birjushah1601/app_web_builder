import { z } from "zod";

export interface KeycloakConfig {
  /** Base URL of the Keycloak server, e.g., https://auth.atlas.app. No trailing slash. */
  baseUrl: string;
  /** Keycloak realm name. */
  realm: string;
  /** OIDC client id registered in the realm. */
  clientId: string;
  /** Confidential-client secret. Omit for public clients using PKCE. */
  clientSecret?: string;
  /** Callback URL registered on the client. */
  redirectUri: string;
  /** Additional scopes beyond `openid profile email`. */
  extraScopes?: string[];
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Injectable jose verify for tests. */
  verifyIdTokenFn?: JwtVerifier;
}

/**
 * The subset of `jose`'s verification we depend on — kept structural so tests
 * can inject a stub without importing jose.
 */
export type JwtVerifier = (
  idToken: string,
  opts: { issuer: string; audience: string; jwksUri: string }
) => Promise<JwtClaims>;

export const JwtClaimsSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().email().optional(),
    email_verified: z.boolean().optional(),
    name: z.string().optional(),
    preferred_username: z.string().optional(),
    iss: z.string().min(1),
    aud: z.union([z.string(), z.array(z.string())]),
    exp: z.number().int().positive(),
    iat: z.number().int().positive()
  })
  .passthrough();
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

export const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    id_token: z.string().min(1),
    refresh_token: z.string().optional(),
    expires_in: z.number().int().positive(),
    token_type: z.string().min(1),
    scope: z.string().optional()
  })
  .passthrough();
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export interface AuthorizeUrlInput {
  /** Anti-CSRF nonce — the caller stores it in session, compares on callback. */
  state: string;
  /** Optional PKCE code_challenge (base64url SHA-256 of the verifier). */
  codeChallenge?: string;
  /** Required when codeChallenge is supplied. */
  codeChallengeMethod?: "S256";
  /** Required OIDC nonce — bound into the ID token. */
  nonce: string;
}

export interface ExchangeCodeInput {
  code: string;
  /** Required when the original authorize used PKCE. */
  codeVerifier?: string;
}

export interface AuthSession {
  subjectId: string;
  email: string | undefined;
  name: string | undefined;
  accessToken: string;
  idToken: string;
  refreshToken: string | undefined;
  expiresAtMs: number;
  claims: JwtClaims;
}
