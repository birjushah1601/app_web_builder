import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Auth shim — return a stable userId so the page passes its gate.
const authMock = vi.fn(async () => ({ userId: "user_test" }));
vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: () => authMock()
}));

// Stub the pg Pool — we don't want a real DB connection in unit tests.
vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({}))
}));

// ProjectsRepo gets stubbed so the test can drive listForUser deterministically.
const listForUserMock = vi.fn();
vi.mock("@atlas/spec-graph-data", () => ({
  ProjectsRepo: vi.fn().mockImplementation(() => ({
    listForUser: listForUserMock
  }))
}));

import LandingPage from "@/app/page";

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ userId: "user_test" });
  listForUserMock.mockReset();
});

describe("LandingPage", () => {
  it("returns null when the user is unauthenticated (middleware redirect path)", async () => {
    authMock.mockResolvedValueOnce({ userId: null } as never);
    const element = await LandingPage();
    expect(element).toBeNull();
  });

  it("renders the empty-state CTA linking to /projects/new when the user has no projects", async () => {
    listForUserMock.mockResolvedValueOnce([]);
    const element = await LandingPage();
    render(element as React.ReactElement);

    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /create your first one/i });
    expect(cta).toHaveAttribute("href", "/projects/new");
  });

  it("renders one row per project, linked to /projects/{id}/canvas", async () => {
    listForUserMock.mockResolvedValueOnce([
      {
        projectId: "11111111-1111-4111-8111-111111111111",
        userId: "user_test",
        name: "Alpha",
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        projectId: "22222222-2222-4222-8222-222222222222",
        userId: "user_test",
        name: "Beta",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
    const element = await LandingPage();
    render(element as React.ReactElement);

    const alpha = screen.getByRole("link", { name: "Alpha" });
    expect(alpha).toHaveAttribute(
      "href",
      "/projects/11111111-1111-4111-8111-111111111111/canvas"
    );
    const beta = screen.getByRole("link", { name: "Beta" });
    expect(beta).toHaveAttribute(
      "href",
      "/projects/22222222-2222-4222-8222-222222222222/canvas"
    );
  });

  it("scopes listForUser to the current user", async () => {
    listForUserMock.mockResolvedValueOnce([]);
    await LandingPage();
    expect(listForUserMock).toHaveBeenCalledWith("user_test");
  });
});
