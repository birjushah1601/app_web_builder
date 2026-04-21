import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Stub Server Actions
vi.mock("../../../lib/actions/code/listPrs.js", () => ({
  listPrs: vi.fn().mockResolvedValue([
    {
      number: 7,
      title: "Add login page",
      state: "open",
      html_url: "https://github.com/acme/app/pull/7",
      head: { ref: "feat/login" },
      base: { ref: "main" },
    },
  ]),
}));

vi.mock("../../../lib/actions/code/openPr.js", () => ({
  openPr: vi.fn().mockResolvedValue({ prNumber: 8, prUrl: "https://github.com/acme/app/pull/8" }),
}));

vi.mock("../../../lib/actions/code/getPrDiff.js", () => ({
  getPrDiff: vi.fn().mockResolvedValue({ diff: "--- a/index.ts\n+++ b/index.ts\n@@ -1 +1 @@\n-old\n+new" }),
}));

vi.mock("../../../components/code/PrDiffViewer.js", () => ({
  PrDiffViewer: ({ diff }: { diff: string }) => <pre data-testid="diff-viewer">{diff}</pre>,
}));

import { PrPane } from "../../../components/code/PrPane.js";
import { listPrs } from "../../../lib/actions/code/listPrs.js";

beforeEach(() => vi.clearAllMocks());

describe("PrPane", () => {
  const props = { projectId: "p-1", repoSlug: "acme/app" };

  it("loads and renders open PRs on mount", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => expect(screen.getByText("Add login page")).toBeInTheDocument());
    expect(listPrs).toHaveBeenCalledWith({ projectId: "p-1", repoSlug: "acme/app", state: "open" });
  });

  it("shows PR number and branch names", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => screen.getByText("Add login page"));
    expect(screen.getByText(/#7/)).toBeInTheDocument();
    expect(screen.getByText(/feat\/login/)).toBeInTheDocument();
  });

  it("renders the diff viewer when a PR is selected", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => screen.getByText("Add login page"));
    fireEvent.click(screen.getByText("Add login page"));
    await waitFor(() => expect(screen.getByTestId("diff-viewer")).toBeInTheDocument());
  });

  it("shows an 'Open PR' form button", async () => {
    render(<PrPane {...props} />);
    await waitFor(() => screen.getByText("Add login page"));
    expect(screen.getByRole("button", { name: /open pr/i })).toBeInTheDocument();
  });
});
