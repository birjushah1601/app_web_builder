import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sealSession, ATLAS_SESSION_COOKIE } from "@/lib/auth/session-cookie.js";

const SECRET = "a".repeat(32);

// Mock both data sources — Clerk for the default path, next/headers for Keycloak.
const clerkAuthMock = vi.fn();
const clerkCurrentUserMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => clerkAuthMock(),
  currentUser: () => clerkCurrentUserMock()
}));

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock()
}));

async function loadGetCurrentUser() {
  vi.resetModules();
  const mod = await import("@/lib/auth/current-user.js");
  return mod.getCurrentUser;
}

function setFlag(value: "0" | "1"): void {
  process.env.ATLAS_FF_AUTH_KEYCLOAK = value;
}

describe("getCurrentUser — Clerk path (flag OFF)", () => {
  beforeEach(() => {
    setFlag("0");
    clerkAuthMock.mockReset();
    clerkCurrentUserMock.mockReset();
  });

  it("returns null when Clerk reports no userId", async () => {
    clerkAuthMock.mockResolvedValue({ userId: null });
    const getCurrentUser = await loadGetCurrentUser();
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns provider=clerk + merged Clerk profile when authenticated", async () => {
    clerkAuthMock.mockResolvedValue({ userId: "clerk_abc" });
    clerkCurrentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "user@atlas.app" }],
      firstName: "Atlas",
      lastName: "User"
    });
    const getCurrentUser = await loadGetCurrentUser();
    const user = await getCurrentUser();
    expect(user).toEqual({
      userId: "clerk_abc",
      provider: "clerk",
      email: "user@atlas.app",
      name: "Atlas User"
    });
  });
});

describe("getCurrentUser — Keycloak path (flag ON)", () => {
  beforeEach(() => {
    setFlag("1");
    process.env.ATLAS_SESSION_SECRET = SECRET;
    cookiesMock.mockReset();
  });

  afterEach(() => {
    delete process.env.ATLAS_SESSION_SECRET;
  });

  it("returns null when ATLAS_SESSION_SECRET is missing", async () => {
    delete process.env.ATLAS_SESSION_SECRET;
    cookiesMock.mockResolvedValue({ get: () => undefined });
    const getCurrentUser = await loadGetCurrentUser();
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null when no session cookie is present", async () => {
    cookiesMock.mockResolvedValue({ get: () => undefined });
    const getCurrentUser = await loadGetCurrentUser();
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns provider=keycloak with sub/email/name when session cookie verifies", async () => {
    const token = await sealSession(
      { sub: "kc_user_123", email: "u@atlas.app", name: "U" },
      { secret: SECRET }
    );
    cookiesMock.mockResolvedValue({
      get: (name: string) => (name === ATLAS_SESSION_COOKIE ? { value: token } : undefined)
    });
    const getCurrentUser = await loadGetCurrentUser();
    const user = await getCurrentUser();
    expect(user).toEqual({
      userId: "kc_user_123",
      provider: "keycloak",
      email: "u@atlas.app",
      name: "U"
    });
  });

  it("returns null (not throws) when the cookie fails to verify", async () => {
    cookiesMock.mockResolvedValue({
      get: (name: string) => (name === ATLAS_SESSION_COOKIE ? { value: "not-a-valid-jwt" } : undefined)
    });
    const getCurrentUser = await loadGetCurrentUser();
    expect(await getCurrentUser()).toBeNull();
  });
});
