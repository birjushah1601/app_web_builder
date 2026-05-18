import "@testing-library/jest-dom/vitest";

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
