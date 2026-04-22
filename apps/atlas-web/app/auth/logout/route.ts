import { NextResponse, type NextRequest } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags.js";
import { ATLAS_SESSION_COOKIE } from "@/lib/auth/session-cookie.js";

async function handle(_req: NextRequest): Promise<NextResponse> {
  if (!isFeatureEnabled("auth-keycloak")) {
    return NextResponse.json({ error: "Keycloak auth not enabled" }, { status: 404 });
  }
  const res = NextResponse.redirect(new URL("/", _req.url), 302);
  res.cookies.delete(ATLAS_SESSION_COOKIE);
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
