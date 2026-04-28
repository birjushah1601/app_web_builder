import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HmrIframe } from "../app/projects/[projectId]/canvas/_components/HmrIframe";

// iframe-resizer is a DOM-side library; mock it in the test environment
vi.mock("iframe-resizer", () => ({
  iframeResize: vi.fn(),
}));

describe("HmrIframe", () => {
  it("renders an iframe with the provided src", () => {
    render(
      <HmrIframe
        src="https://3000-sbx_abc.e2b.app"
        title="Live preview"
      />
    );
    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.src).toBe("https://3000-sbx_abc.e2b.app/");
  });

  it("renders a skeleton placeholder when src is undefined", () => {
    const { container } = render(<HmrIframe src={undefined} title="Live preview" />);
    expect(container.querySelector("[data-testid='hmr-iframe-skeleton']")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("calls onLoad callback when iframe fires load event", async () => {
    const onLoad = vi.fn();
    render(
      <HmrIframe src="https://3000-sbx_abc.e2b.app" title="Live preview" onLoad={onLoad} />
    );
    const iframe = screen.getByTitle("Live preview");
    iframe.dispatchEvent(new Event("load"));
    expect(onLoad).toHaveBeenCalledOnce();
  });
});
