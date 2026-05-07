import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Plan S.5 — visual fixture routes under /__visual__/* are dev/test-only.
// Hard-404 in production so they can never leak to real users even if a
// route file ships by accident. In dev/test the routes are public (no
// Clerk auth) so Playwright can hit them without the global-setup signin
// flow.
const isVisualFixtureRoute = createRouteMatcher(["/__visual__(.*)"]);

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
