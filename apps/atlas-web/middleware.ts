import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Plan S.5 — visual fixture routes are dev/test-only.
//
// Note on path: the plan originally specified `/__visual__/*` as the URL
// space, but Next.js App Router treats any folder starting with `_` as a
// private (un-routable) folder and short-circuits the request with 404
// BEFORE middleware runs. We keep the same intent — a non-overlapping
// segment that's never used in production — under the routable name
// `/visual-fixtures/*`. Both folder name and URL share that name; the
// production guard below 404s the URL space so it can never leak.
const isVisualFixtureRoute = createRouteMatcher(["/visual-fixtures(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isVisualFixtureRoute(req)) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(null, { status: 404 });
    }
    return; // dev/test: bypass auth so Playwright can render the fixture
  }
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"]
};
