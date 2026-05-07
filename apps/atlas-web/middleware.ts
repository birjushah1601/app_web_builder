import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Plan S.5 — visual fixture routes are exposed at /__visual__/* but live
// in app/visual-fixtures/ on disk. Next.js treats any folder name starting
// with `_` as private (un-routable), so we keep the folder name normal
// and rewrite the public-facing URL via middleware. The /__visual__/*
// URL space is still 404'd in production so it cannot leak to real users
// even though the underlying routes always exist.
const isVisualFixtureRoute = createRouteMatcher(["/__visual__(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isVisualFixtureRoute(req)) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(null, { status: 404 });
    }
    // dev/test: rewrite /__visual__/<rest> → /visual-fixtures/<rest>.
    const rest = req.nextUrl.pathname.replace(/^\/__visual__/, "");
    const url = req.nextUrl.clone();
    url.pathname = `/visual-fixtures${rest}`;
    return NextResponse.rewrite(url);
  }
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"]
};
