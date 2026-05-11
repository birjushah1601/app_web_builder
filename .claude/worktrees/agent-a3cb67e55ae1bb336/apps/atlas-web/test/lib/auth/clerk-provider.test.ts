import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("ClerkAuthProvider", () => {
  it("getCurrentUserId returns the auth() userId", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: () => ({ userId: "user_abc" })
    }));
    const { ClerkAuthProvider } = await import("@/lib/auth/clerk-provider");
    const p = new ClerkAuthProvider();
    expect(await p.getCurrentUserId()).toBe("user_abc");
  });

  it("returns null when no session", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: null }) }));
    const { ClerkAuthProvider } = await import("@/lib/auth/clerk-provider");
    const p = new ClerkAuthProvider();
    expect(await p.getCurrentUserId()).toBeNull();
  });

  it("signInUrl wraps the configured sign-in path with returnTo", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: null }) }));
    const { ClerkAuthProvider } = await import("@/lib/auth/clerk-provider");
    const p = new ClerkAuthProvider();
    expect(p.signInUrl("/projects/p-1/canvas")).toBe("/sign-in?redirect_url=%2Fprojects%2Fp-1%2Fcanvas");
  });
});
