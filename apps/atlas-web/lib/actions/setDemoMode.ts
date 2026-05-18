"use server";

/**
 * Server Action — sets (or clears) the `atlas-demo-mode` cookie that
 * gates the runtime demo-mode override. See lib/feature-flags.ts for the
 * cookie/env precedence rules.
 *
 * Cookie shape:
 *   - "true"  → demo mode forced on  (beats env OFF)
 *   - "false" → demo mode forced off (beats env ON)
 *   - unset   → env wins
 *
 * HttpOnly is intentionally false: the canvas header's checkbox reads
 * the same cookie on the client to render its checked state without an
 * extra round-trip. The cookie is per-browser convenience, not a
 * security boundary — the actual LLM swap still happens server-side
 * inside the engine factory.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCookieNameForFlag } from "@/lib/feature-flags";

export async function setDemoMode({
  enabled,
  projectId
}: {
  enabled: boolean;
  projectId?: string;
}): Promise<void> {
  const cookieName = getCookieNameForFlag("demo-mode");
  if (!cookieName) {
    // Defensive — getCookieNameForFlag returns the literal "atlas-demo-mode"
    // for "demo-mode" today. If a future refactor drops the mapping we want
    // a loud failure rather than a silent no-op.
    throw new Error("demo-mode flag has no cookie mapping");
  }
  const cookieStore = await cookies();
  cookieStore.set(cookieName, enabled ? "true" : "false", {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    // 30 days — enough for a long demo session, not so long that a stale
    // cookie outlives a flag rename.
    maxAge: 60 * 60 * 24 * 30
  });
  // The canvas page re-evaluates the engine factory + the header badge on
  // navigation, so revalidate the project path so the next render picks
  // up the new cookie immediately.
  if (projectId) {
    revalidatePath(`/projects/${projectId}/canvas`);
  }
}
