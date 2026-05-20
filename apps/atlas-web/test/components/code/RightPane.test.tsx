import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../../../lib/actions/code/runTerminalCommand", () => ({
  runTerminalCommand: vi.fn().mockResolvedValue({
    stdout: "",
    stderr: "",
    exitCode: 0,
  }),
}));

vi.mock("../../../lib/actions/code/getTestResults", () => ({
  getTestResults: vi.fn().mockResolvedValue({
    status: "stub",
    suites: [],
    message: "test runner not connected yet (E.4)",
  }),
}));

// Mock PrPane to avoid needing its dependencies
vi.mock("../../../components/code/PrPane", () => ({
  PrPane: () => <div data-testid="pr-pane">PR Pane</div>,
}));

import { RightPane } from "../../../components/code/RightPane";

beforeEach(() => vi.clearAllMocks());

const PROPS = { projectId: "p-1" };

describe("RightPane tab navigation", () => {
  it("renders the PR tab by default", () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    expect(screen.getByRole("tab", { name: /pr/i })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to Terminal tab when clicked", () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /terminal/i }));
    expect(screen.getByRole("tab", { name: /terminal/i })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to Tests tab when clicked", () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /tests/i }));
    expect(screen.getByRole("tab", { name: /tests/i })).toHaveAttribute("aria-selected", "true");
  });

  it("renders the terminal input in the Terminal tab", async () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /terminal/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/terminal command/i)).toBeInTheDocument()
    );
  });

  it("shows the stub message in the Tests tab", async () => {
    render(<RightPane {...PROPS} repoSlug="acme/app" />);
    fireEvent.click(screen.getByRole("tab", { name: /tests/i }));
    await waitFor(() =>
      expect(screen.getByText(/test runner not connected yet/i)).toBeInTheDocument()
    );
  });
});
