import "@testing-library/jest-dom/vitest";

// jsdom defines HTMLFormElement.prototype.requestSubmit as a function that
// throws "Not implemented" — so a truthy-check guard does NOT skip past it.
// React 19 form actions call requestSubmit() when a submit button is clicked;
// without this polyfill, every fireEvent.click on a submit-inside-form throws.
// Override unconditionally with a real synthetic-submit-event dispatch.
if (typeof HTMLFormElement !== "undefined") {
  HTMLFormElement.prototype.requestSubmit = function (submitter?: HTMLElement) {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    if (submitter) Object.defineProperty(event, "submitter", { value: submitter });
    this.dispatchEvent(event);
  };
}

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
