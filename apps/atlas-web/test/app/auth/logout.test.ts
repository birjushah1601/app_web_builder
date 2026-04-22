import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";

async function loadRoute() {
  const mod = await import("@/app/auth/logout/route.js");
  return mod.GET;
}

describe("/auth/logout", () => {
  afterEach(() => {
    delete process.env.ATLAS_FF_AUTH_KEYCLOAK;
  });

  it("404s when flag is off", async () => {
    delete process.env.ATLAS_FF_AUTH_KEYCLOAK;
    const GET = await loadRoute();
    const res = await GET(new NextRequest("http://localhost/auth/logout"));
    expect(res.status).toBe(404);
  });

  it("redirects to / and clears the session cookie when flag is on", async () => {
    process.env.ATLAS_FF_AUTH_KEYCLOAK = "1";
    const GET = await loadRoute();
    const res = await GET(new NextRequest("http://localhost/auth/logout"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/");
    const setCookies = res.headers.getSetCookie();
    const sessionCookie = setCookies.find((c) => c.startsWith("__atlas_session="));
    expect(sessionCookie).toBeDefined();
    // Next.js clears cookies via an Expires-in-1970 marker instead of Max-Age=0;
    // either signal tells a conforming browser to drop the cookie immediately.
    expect(sessionCookie).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });
});
