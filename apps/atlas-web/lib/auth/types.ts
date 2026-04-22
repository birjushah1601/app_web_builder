/**
 * Unified auth user shape that `getCurrentUser()` returns regardless of
 * whether the request was authenticated by Clerk or Keycloak. Keep this
 * narrow — call sites that need provider-specific fields should branch on
 * `provider` explicitly.
 */
export type AuthProvider = "clerk" | "keycloak";

export interface AuthUser {
  /**
   * Stable subject id — Clerk user id, or the `sub` claim from the Keycloak
   * id_token. Treat as opaque; never parse.
   */
  userId: string;
  /** Which backend authenticated this request. */
  provider: AuthProvider;
  /** Optional display info pulled from the id_token or Clerk profile. */
  email?: string;
  name?: string;
  /**
   * Free-form metadata from the auth backend. Clerk → `publicMetadata`;
   * Keycloak → id_token claims minus the standard sub/email/name set.
   * Callers must treat every field as optional.
   */
  publicMetadata?: Record<string, unknown>;
}
