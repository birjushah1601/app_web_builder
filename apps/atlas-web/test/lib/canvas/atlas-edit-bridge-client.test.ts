import { describe, it, expect, vi } from "vitest";
import { bridgeApplyText, bridgeReplaceImg, bridgeMakeEditable } from "@/lib/canvas/atlas-edit-bridge-client";

describe("atlas-edit-bridge-client", () => {
  it("bridgeApplyText posts atlas-apply-text to the iframe contentWindow", () => {
    const post = vi.fn();
    const iframe = { contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
    bridgeApplyText(iframe, { atlasId: "h", newText: "Hi" });
    expect(post).toHaveBeenCalledWith(
      { type: "atlas-apply-text", atlasId: "h", newText: "Hi" },
      "*"
    );
  });

  it("bridgeReplaceImg posts atlas-replace-img with src + optional alt", () => {
    const post = vi.fn();
    const iframe = { contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
    bridgeReplaceImg(iframe, { atlasId: "img1", newUrl: "/x.jpg", newAlt: "X" });
    expect(post).toHaveBeenCalledWith(
      { type: "atlas-replace-img", atlasId: "img1", newUrl: "/x.jpg", newAlt: "X" },
      "*"
    );
  });

  it("bridgeMakeEditable posts atlas-make-editable", () => {
    const post = vi.fn();
    const iframe = { contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
    bridgeMakeEditable(iframe, { atlasId: "h" });
    expect(post).toHaveBeenCalledWith(
      { type: "atlas-make-editable", atlasId: "h" },
      "*"
    );
  });
});
