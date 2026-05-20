import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { IframeOverlay } from "@/components/canvas/IframeOverlay";

/**
 * Plan UXO change 3 — IframeOverlay renders hit-zones over the preview
 * iframe driven by postMessage from the sandbox's atlas-edit-bridge.
 *
 * jsdom's window.postMessage is asynchronous (queues a task). To keep the
 * test deterministic we dispatch a synchronous MessageEvent on `window`
 * wrapped in act() so React flushes the resulting state update before we
 * assert. Same shape as the bridge's payload — { type: "atlas-dom-tree",
 * nodes: [...] }.
 */
describe("<IframeOverlay>", () => {
  it("renders a hit-zone per node from postMessage", () => {
    const onSelect = vi.fn();
    const ref = React.createRef<HTMLIFrameElement>();
    render(<IframeOverlay iframeRef={ref} onSelect={onSelect} />);

    // Sanity: no hit-zones before any message arrives.
    expect(screen.queryAllByTestId("iframe-overlay-hit-zone")).toHaveLength(0);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "atlas-dom-tree",
            nodes: [
              {
                selector: "h1:nth-child(1)",
                atlasId: "test-id-1",
                tag: "h1",
                text: "Hello",
                rect: { x: 10, y: 20, width: 100, height: 30 },
                classes: []
              },
              {
                selector: "p:nth-child(2)",
                atlasId: "test-id-2",
                tag: "p",
                text: "World",
                rect: { x: 10, y: 60, width: 200, height: 24 },
                classes: ["text-lg"]
              }
            ]
          }
        })
      );
    });

    const zones = screen.getAllByTestId("iframe-overlay-hit-zone");
    expect(zones).toHaveLength(2);
    expect(zones[0]!.getAttribute("data-selector")).toBe("h1:nth-child(1)");
    // Position from the message lands in inline styles so the overlay
    // visually tracks the element inside the iframe.
    expect(zones[0]!.style.left).toBe("10px");
    expect(zones[0]!.style.top).toBe("20px");
    expect(zones[0]!.style.width).toBe("100px");
    expect(zones[0]!.style.height).toBe("30px");
  });

  it("ignores unrelated postMessage payloads", () => {
    const onSelect = vi.fn();
    const ref = React.createRef<HTMLIFrameElement>();
    render(<IframeOverlay iframeRef={ref} onSelect={onSelect} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "some-other-event" } }));
      window.dispatchEvent(new MessageEvent("message", { data: null }));
    });
    expect(screen.queryAllByTestId("iframe-overlay-hit-zone")).toHaveLength(0);
  });

  it("fires onSelect when a hit-zone is clicked", () => {
    const onSelect = vi.fn();
    const ref = React.createRef<HTMLIFrameElement>();
    render(<IframeOverlay iframeRef={ref} onSelect={onSelect} />);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "atlas-dom-tree",
            nodes: [
              {
                selector: "button:nth-child(1)",
                atlasId: "test-id-1",
                tag: "button",
                text: "Click me",
                rect: { x: 0, y: 0, width: 80, height: 32 },
                classes: []
              }
            ]
          }
        })
      );
    });
    const zone = screen.getByTestId("iframe-overlay-hit-zone");
    act(() => {
      zone.click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0].selector).toBe("button:nth-child(1)");
  });
});
