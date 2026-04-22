import { cookies } from "next/headers";
import { isFeatureEnabled } from "@/lib/feature-flags.js";
import { ATLAS_SESSION_COOKIE, unsealSession, SessionSealError } from "./session-cookie.js";
import type { AuthUser } from "./types.js";

/**
 * Return the currently authenticated user, or null if the request is
 * unauthenticated. Dispatches between Clerk (default) and Keycloak based on
 * the ATLAS_FF_AUTH_KEYCLOAK feature flag.
 *
 * Callers that previously did `const { userId } = await auth()` can migrate to
 * `const user = await getCurrentUser(); const userId = user?.userId ?? null`.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isFeatureEnabled("auth-keycloak")) {
    return readKeycloakSession();
  }
  return readClerkSession();
}

async function readClerkSession(): Promise<AuthUser | null> {
  const clerk = await import("@clerk/nextjs/server");
  const { userId } = await clerk.auth();
  if (!userId) return null;

  // currentUser() is separate from auth() — some call sites (and many old
  // tests) only stub auth. Tolerate a missing implementation by falling back
  // to a userId-only session rather than crashing the whole request.
  let clerkUser: {
    emailAddresses?: Array<{ emailAddress: string }>;
    firstName?: string | null;
    lastName?: string | null;
    publicMetadata?: Record<string, unknown>;
  } | null = null;
  try {
    clerkUser = (await clerk.currentUser()) as typeof clerkUser;
  } catch {
    clerkUser = null;
  }

  return {
    userId,
    provider: "clerk",
    email: clerkUser?.emailAddresses?.[0]?.emailAddress,
    name: clerkUser?.firstName
      ? `${clerkUser.firstName} ${clerkUser.lastName ?? ""}`.trim()
      : undefined,
    publicMetadata: clerkUser?.publicMetadata ?? {}
  };
}

async function readKeycloakSession(): Promise<AuthUser | null> {
  const secret = process.env.ATLAS_SESSION_SECRET;
  if (!secret) return null;
  const cookieStore = await cookies();
  const raw = cookieStore.get(ATLAS_SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const claims = await unsealSession(raw, { secret });
    return {
      userId: claims.sub,
      provider: "keycloak",
      email: claims.email,
      name: claims.name
    };
  } catch (err) {
    if (err instanceof SessionSealError) return null;
    throw err;
  }
}
