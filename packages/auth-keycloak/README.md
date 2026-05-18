# @atlas/auth-keycloak

OIDC code-flow adapter against any Keycloak realm. Per ADR-001 §7, Keycloak is Atlas's sovereign-deployment auth provider — this package is the library Atlas uses when the `ATLAS_FF_AUTH_KEYCLOAK` feature flag is on.

## API

```ts
import { KeycloakAuthProvider } from "@atlas/auth-keycloak";

const auth = new KeycloakAuthProvider({
  baseUrl: "https://auth.atlas.app",
  realm: "atlas",
  clientId: "atlas-web",
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET, // omit for public-client PKCE flow
  redirectUri: "https://atlas.app/auth/callback"
});

// /auth/start
const url = auth.getAuthorizeUrl({
  state: crypto.randomUUID(),
  nonce: crypto.randomUUID(),
  codeChallenge,       // optional — PKCE
  codeChallengeMethod: "S256"
});
res.redirect(url);

// /auth/callback
const session = await auth.completeCodeFlow({ code, codeVerifier });
// session.subjectId, session.email, session.accessToken, session.claims ...

// Later — refresh
const refreshed = await auth.refreshTokens(session.refreshToken!);
```

`completeCodeFlow` does three things:
1. POST to the token endpoint with the auth code.
2. Verify the `id_token` signature + issuer + audience against the realm's JWKS (via `jose.jwtVerify`).
3. Parse the claims with a Zod schema and return an `AuthSession`.

## Seams for tests

Both `fetchFn` and `verifyIdTokenFn` are injectable through the constructor config — pass mocks and test the whole flow without a real Keycloak or real JWT.

## Integration with atlas-web

Not yet wired. The atlas-web side (middleware + session helpers + sign-in/sign-out pages) is a separate unit of work that pairs with dropping Clerk from the self-host path. Feature-flag it behind `ATLAS_FF_AUTH_KEYCLOAK` (already in the `@atlas/feature-flags` registry) so the Clerk path keeps working for hosted dev.

## ADR reference

ADR-001 §7 (2026-04-22). See also D12 in `docs/superpowers/known-deferrals.md`.
