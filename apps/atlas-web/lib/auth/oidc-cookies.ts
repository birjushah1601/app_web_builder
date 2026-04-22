/** Short-lived state nonce for CSRF protection on the /auth/callback. */
export const STATE_COOKIE = "__atlas_oidc_state";
/** Short-lived OIDC nonce bound into the id_token. */
export const NONCE_COOKIE = "__atlas_oidc_nonce";
/** Options shared by /auth/start when setting short-lived transit cookies. */
export const OIDC_TRANSIT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 10 * 60
};
