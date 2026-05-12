import { describe, it, expect } from "vitest";
import { renderDeveloperUserTurn } from "../src/render-user-turn.js";

describe("renderDeveloperUserTurn — assetManifest", () => {
  it("renders assetManifest hero URL when present", () => {
    const out = renderDeveloperUserTurn("build", {
      assetManifest: {
        hero: { slot: "hero", url: "/atlas-assets/x.jpg", alt: "h" },
        sections: []
      }
    });
    expect(out).toContain("/atlas-assets/x.jpg");
    expect(out).toContain("don't invent image URLs");
  });

  it("renders section URLs when present", () => {
    const out = renderDeveloperUserTurn("build", {
      assetManifest: {
        hero: { slot: "hero", url: "/atlas-assets/hero.jpg", alt: "h" },
        sections: [
          { slot: "features", url: "/atlas-assets/feat.jpg", alt: "features" },
          { slot: "gallery", url: "/atlas-assets/gal.jpg", alt: "gallery" }
        ]
      }
    });
    expect(out).toContain("/atlas-assets/feat.jpg");
    expect(out).toContain("/atlas-assets/gal.jpg");
    expect(out).toContain("features");
    expect(out).toContain("gallery");
  });

  it("omits the assetManifest section when both hero + sections are absent", () => {
    const out = renderDeveloperUserTurn("build", { assetManifest: { sections: [] } });
    expect(out).not.toContain("Asset manifest");
  });

  it("falls back gracefully when architectArtifact has no assetManifest field", () => {
    const out = renderDeveloperUserTurn("build", { runnablePlan: { tasks: [] } });
    expect(out).not.toContain("Asset manifest");
  });
});
