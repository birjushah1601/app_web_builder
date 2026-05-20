/**
 * Server-only adapter that builds a FeatureFlagSource over both
 * `process.env` AND `next/headers`'s cookie store. Use this from any
 * Server Component, Server Action, or Route Handler that needs cookie
 * precedence (today: demo-mode toggle).
 *
 * Why a separate file: importing `next/headers` from feature-flags.ts
 * would force every consumer (including unit tests + Edge code paths
 * without a request scope) to bring along Next's request cache, which
 * fails outside a request context. Keeping the cookie adapter behind
 * a server-only helper keeps the core flag library framework-agnostic.
 */

import { cookies } from "next/headers";
import {
  isFeatureEnabled,
  type FeatureFlag,
  type FeatureFlagSource
} from "@/lib/feature-flags";

/**
 * Build a feature-flag source that reads env from process.env and, when
 * available, cookies from the active Next.js request. Outside a request
 * context (engine factory init, unit tests, background workers), the
 * cookie reader is silently skipped — env wins. Inside a request, cookie
 * precedence works as designed.
 */
export async function getRequestFeatureFlagSource(): Promise<FeatureFlagSource> {
  let readCookie: FeatureFlagSource["readCookie"] = () => undefined;
  try {
    const cookieStore = await cookies();
    readCookie = (name) => cookieStore.get(name)?.value;
  } catch {
    // No request scope. Fall back to env-only — keeps factory init,
    // tests, and async background contexts from crashing on cookies().
  }
  return {
    readEnv: (name) => process.env[name],
    readCookie
  };
}

/**
 * Convenience wrapper around `isFeatureEnabled` that uses the
 * request-scoped source. Equivalent to:
 *
 *   const src = await getRequestFeatureFlagSource();
 *   isFeatureEnabled(flag, src);
 *
 * Server Components reach for this to honor the cookie override without
 * hand-rolling the source on every call site.
 */
export async function isFeatureEnabledForRequest(
  flag: FeatureFlag
): Promise<boolean> {
  const source = await getRequestFeatureFlagSource();
  return isFeatureEnabled(flag, source);
}
