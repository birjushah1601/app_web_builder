import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Stub the Server Action chain — the real module imports the engine factory
// which pulls in pg/drizzle/clerk at module init and blows up in a unit-test
// environment. The page only needs the action as a reference for <form>.
vi.mock("@/app/projects/new/actions", () => ({
  submitPromptedProject: vi.fn()
}));

import NewProjectPage from "@/app/projects/new/page";

describe("NewProjectPage", () => {
  it("renders the PromptForm", () => {
    render(<NewProjectPage />);

    expect(screen.getByRole("heading", { name: /what do you want to build/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/what do you want to build/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /let ai decide/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeInTheDocument();
  });
});
