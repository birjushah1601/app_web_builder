/**
 * Shim that matches Clerk's server-side API shape (`auth()`, `currentUser()`)
 * but dispatches through `getCurrentUser()` so it honors the
 * `ATLAS_FF_AUTH_KEYCLOAK` flag.
 *
 * Existing Server Actions migrate by changing one import line:
 *
 *   -import { auth } from "@clerk/nextjs/server";
 *   +import { auth } from "@/lib/auth/clerk-compat";
 *
 * Behaviour:
 * - Flag OFF (default): delegates to Clerk's real `auth()` / `currentUser()`.
 *   Existing code keeps working identically.
 * - Flag ON: reads the Atlas session cookie, returns the same Clerk-shape
 *   values so call sites don't need to branch.
 */
import { getCurrentUser } from "./current-user";

/** Matches the subset of Clerk's `auth()` return shape that Atlas code uses. */
export interface AuthShape {
  userId: string | null;
}

export async function auth(): Promise<AuthShape> {
  const user = await getCurrentUser();
  return { userId: user?.userId ?? null };
}

/** Matches the subset of Clerk's `currentUser()` return shape that Atlas code uses. */
export interface CurrentUserShape {
  id: string;
  emailAddresses: Array<{ emailAddress: string }>;
  firstName: string | null;
  lastName: string | null;
  /**
   * Free-form metadata. Clerk → `publicMetadata`; Keycloak → id_token
   * claims. Callers MUST treat every field as optional.
   */
  publicMetadata: Record<string, unknown>;
}

export async function currentUser(): Promise<CurrentUserShape | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const [firstName, ...rest] = (user.name ?? "").split(" ");
  return {
    id: user.userId,
    emailAddresses: user.email ? [{ emailAddress: user.email }] : [],
    firstName: firstName || null,
    lastName: rest.join(" ") || null,
    publicMetadata: user.publicMetadata ?? {}
  };
}
