import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CanvasPreviewClient } from "@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient";

// HmrIframe imports iframe-resizer dynamically; jsdom doesn't need it for
// these tests. Stub it so the import doesn't crash environments without
// the dep installed at test time.
vi.mock("iframe-resizer", () => ({ iframeResize: () => undefined }));

describe("CanvasPreviewClient", () => {
  it("renders the iframe when a previewUrl is supplied", () => {
    render(
      <CanvasPreviewClient
        projectId="p-1"
        sandboxId="sb-1"
        previewUrl="https://sb-1.preview.example/"
      />
    );
    expect(screen.queryByTestId("canvas-preview-error")).not.toBeInTheDocument();
    // Heading buttons (Share + viewport toggle) still mount when there's no error
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  it("renders the loading skeleton when previewUrl is undefined and no error", () => {
    render(
      <CanvasPreviewClient
        projectId="p-1"
        sandboxId=""
        previewUrl={undefined}
      />
    );
    expect(screen.queryByTestId("canvas-preview-error")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/sandbox preview loading/i)).toBeInTheDocument();
  });

  it("surfaces the previewError instead of the loading skeleton when provision failed", () => {
    render(
      <CanvasPreviewClient
        projectId="p-1"
        sandboxId=""
        previewUrl={undefined}
        previewError="E2B spend cap exceeded for project p-1"
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Preview unavailable/);
    expect(alert).toHaveTextContent(/E2B spend cap exceeded/);
    // Loading skeleton must NOT be rendered when an error is shown — that's
    // the whole point of this fix (no more forever-spinner).
    expect(screen.queryByLabelText(/sandbox preview loading/i)).not.toBeInTheDocument();
  });

  it("error panel includes a recovery hint pointing at common causes", () => {
    render(
      <CanvasPreviewClient
        projectId="p-1"
        sandboxId=""
        previewUrl={undefined}
        previewError="missing E2B_API_KEY"
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/spend cap, API key, sandbox quota/i);
  });
});
