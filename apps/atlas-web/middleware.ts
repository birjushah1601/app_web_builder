import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Plan S.5 — visual fixture routes under /__visual__/* are dev/test-only.
// Hard-404 in production so they can never leak to real users even if a
// route file ships by accident. Local dev + Playwright runs (NODE_ENV=test
// or development) get the full route through.
const isVisualFixtureRoute = createRouteMatcher(["/__visual__(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (process.env.NODE_ENV === "production" && isVisualFixtureRoute(req)) {
    return new NextResponse(null, { status: 404 });
  }
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"]
};
