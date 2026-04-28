import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HmrIframe } from "../app/projects/[projectId]/canvas/_components/HmrIframe";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { RitualEvent } from "@/lib/events/EventBroker";

// iframe-resizer is a DOM-side library; mock it in the test environment
vi.mock("iframe-resizer", () => ({
  iframeResize: vi.fn(),
}));

// Plan F: HmrIframe consumes useReloadOnApplied which reads useEventStream.
// Each test sets the return value via mockReturnValue / mockImplementation.
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: vi.fn(() => ({ events: [], status: "disabled", lastEventId: null }))
}));

describe("HmrIframe", () => {
  it("renders an iframe with the provided src", () => {
    render(
      <HmrIframe
        src="https://3000-sbx_abc.e2b.app"
        title="Live preview"
        projectId="proj-1"
      />
    );
    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.src).toBe("https://3000-sbx_abc.e2b.app/");
  });

  it("renders a skeleton placeholder when src is undefined", () => {
    const { container } = render(<HmrIframe src={undefined} title="Live preview" projectId="proj-1" />);
    expect(container.querySelector("[data-testid='hmr-iframe-skeleton']")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("calls onLoad callback when iframe fires load event", async () => {
    const onLoad = vi.fn();
    render(
      <HmrIframe src="https://3000-sbx_abc.e2b.app" title="Live preview" onLoad={onLoad} projectId="proj-1" />
    );
    const iframe = screen.getByTitle("Live preview");
    iframe.dispatchEvent(new Event("load"));
    expect(onLoad).toHaveBeenCalledOnce();
  });
});

function applyOk(id: string): RitualEvent {
  return {
    id,
    projectId: "proj-1",
    ritualId: "r-1",
    type: "sandbox.apply.completed",
    payload: { ok: true },
    ts: Date.now()
  };
}

describe("HmrIframe — projectId prop + cache-buster src wiring", () => {
  it("renders with no atlas-reload query param when cacheBuster is empty (no reload triggered yet)", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    render(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.src).not.toContain("atlas-reload=");
  });

  it("after an ok:true event + 500ms debounce, iframe.src contains atlas-reload=<eventId>", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts], status: "open", lastEventId: evts.at(-1)?.id ?? null
      }));

      const { rerender } = render(
        <HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />
      );

      evts.push(applyOk("proj-1:42"));
      rerender(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });

      const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
      expect(iframe.src).toContain("atlas-reload=proj-1%3A42"); // ":" is URL-encoded by the browser
    } finally {
      vi.useRealTimers();
    }
  });

  it("appends with '&' when previewUrl already contains a '?'", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts], status: "open", lastEventId: evts.at(-1)?.id ?? null
      }));

      const { rerender } = render(
        <HmrIframe src="https://3000-sbx.e2b.app/?foo=bar" title="Live preview" projectId="proj-1" />
      );

      evts.push(applyOk("proj-1:1"));
      rerender(<HmrIframe src="https://3000-sbx.e2b.app/?foo=bar" title="Live preview" projectId="proj-1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });

      const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
      expect(iframe.src).toContain("foo=bar&atlas-reload=");
    } finally {
      vi.useRealTimers();
    }
  });
});
