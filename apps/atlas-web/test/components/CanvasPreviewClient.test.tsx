import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// HmrIframe imports iframe-resizer dynamically; jsdom doesn't need it for
// these tests. Stub it so the import doesn't crash environments without
// the dep installed at test time.
vi.mock("iframe-resizer", () => ({ iframeResize: () => undefined }));

// Plan F: HmrIframe consumes useReloadOnApplied which reads useEventStream.
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: vi.fn(() => ({ events: [], status: "disabled", lastEventId: null }))
}));

// Plan UXO Task 8 — CanvasPreviewClient now imports ElementInspector,
// which in turn pulls in applyElementAxisChange → lib/sandbox/factory
// → @atlas/sandbox-e2b. Vitest can't resolve that workspace package's
// entry here, so we stub both server actions at the module boundary.
// The inspector itself is only mounted when both flag+mode line up, so
// these stubs are effectively never called by the existing test cases.
vi.mock("@/lib/actions/proposeElementAxes", () => ({
  proposeElementAxes: vi.fn().mockResolvedValue([])
}));
vi.mock("@/lib/actions/applyElementAxisChange", () => ({
  applyElementAxisChange: vi.fn().mockResolvedValue(undefined)
}));

import { CanvasPreviewClient } from "@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient";

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

  it("renders the empty preview backdrop when previewUrl is undefined and no error", () => {
    render(
      <CanvasPreviewClient
        projectId="p-1"
        sandboxId=""
        previewUrl={undefined}
      />
    );
    expect(screen.queryByTestId("canvas-preview-error")).not.toBeInTheDocument();
    // Plan R Task 9 replaced the animate-pulse skeleton with EmptyPreviewBackdrop.
    expect(screen.getByTestId("empty-preview-backdrop")).toBeInTheDocument();
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
    // Empty backdrop must NOT be rendered when an error is shown — that's
    // the whole point of this fix (no more forever-spinner under an error).
    expect(screen.queryByTestId("empty-preview-backdrop")).not.toBeInTheDocument();
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

describe("CanvasPreviewClient — forwards projectId to HmrIframe (plan F wiring)", () => {
  it("passes projectId so HmrIframe can subscribe to the SSE stream", () => {
    render(
      <CanvasPreviewClient
        projectId="proj-from-parent"
        sandboxId="sbx-1"
        previewUrl="https://3000-sbx.e2b.app"
      />
    );
    // The Reload button is rendered by HmrIframe — its presence confirms
    // HmrIframe mounted, and HmrIframe requires projectId to mount (TS-checked).
    expect(screen.getByTestId("preview-reload-button")).toBeTruthy();
  });
});
