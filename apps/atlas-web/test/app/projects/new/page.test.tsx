import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Stub the Server Action chain — the real module imports the engine factory
// which pulls in pg/drizzle/clerk at module init and blows up in a unit-test
// environment. The page only needs the action as a reference for <form>.
vi.mock("@/app/projects/new/actions", () => ({
  submitPromptedProject: vi.fn()
}));

// Plan UXO Task 6 — NewProjectPage is now an async Server Component that
// awaits isFeatureEnabledForRequest before rendering. Stub the flag read so
// the page resolves synchronously to the same shape in the unit-test env.
vi.mock("@/lib/feature-flags-server", () => ({
  isFeatureEnabledForRequest: vi.fn(async () => false)
}));

import NewProjectPage from "@/app/projects/new/page";

describe("NewProjectPage", () => {
  it("renders the PromptForm", async () => {
    // Page is async Server Component — RTL can't render a Promise, so call
    // it as a function and await the element before passing to render().
    const element = await (NewProjectPage as unknown as () => Promise<React.ReactElement>)();
    render(element);

    expect(screen.getByRole("heading", { name: /what do you want to build/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/what do you want to build/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /let ai decide/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeInTheDocument();
  });
});
