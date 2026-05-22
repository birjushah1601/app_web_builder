import "@testing-library/jest-dom/vitest";

// React's `cache()` is a Server Component primitive that resolves to
// undefined in vitest's jsdom env. Stub it as identity so factory.ts and
// any other server-side code wrapping handlers with cache() can be tested.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

// Default Clerk mock — tests can override
vi.mock("@clerk/nextjs", async () => ({
  auth: () => ({ userId: "test-user-id", protect: () => {} }),
  currentUser: async () => ({ id: "test-user-id", emailAddresses: [{ emailAddress: "test@atlas.dev" }] }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  UserButton: () => null
}));

vi.mock("@clerk/nextjs/server", async () => ({
  auth: () => ({ userId: "test-user-id" })
}));
