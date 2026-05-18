import { KeycloakAuthProvider } from "@atlas/auth-keycloak";

/**
 * Construct a KeycloakAuthProvider from env. Throws if required env is
 * absent — route handlers catch + 500. Called per request so env changes
 * take effect without restart during dev; cache at module scope if this
 * becomes a hot path.
 */
export function keycloakFromEnv(): KeycloakAuthProvider {
  const baseUrl = requiredEnv("KEYCLOAK_BASE_URL");
  const realm = requiredEnv("KEYCLOAK_REALM");
  const clientId = requiredEnv("KEYCLOAK_CLIENT_ID");
  const redirectUri = requiredEnv("KEYCLOAK_REDIRECT_URI");
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
  return new KeycloakAuthProvider({
    baseUrl,
    realm,
    clientId,
    redirectUri,
    clientSecret
  });
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}
