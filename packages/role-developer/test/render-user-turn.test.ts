import { describe, it, expect } from "vitest";
import { renderDeveloperUserTurn } from "../src/render-user-turn.js";

describe("renderDeveloperUserTurn layoutDirective", () => {
  it("surfaces selectedLayoutDirective as the page skeleton when present", () => {
    const artifact = {
      selectedTokens: {
        palette: { primary: "#000" },
        componentSet: "shadcn"
      },
      selectedLayoutDirective: "Hero with food close-up. Menu by category. NO testimonials."
    };
    const out = renderDeveloperUserTurn("build", artifact);
    expect(out).toContain("Hero with food close-up");
    expect(out).toContain("NO testimonials");
    // The hardcoded "hero + 2-4 supporting sections" formula should NOT appear
    // when layoutDirective is supplied:
    expect(out).not.toMatch(/2-4 supporting sections/);
  });

  it("falls back to the legacy scaffold when selectedLayoutDirective is absent", () => {
    const artifact = {
      selectedTokens: {
        palette: { primary: "#000" },
        componentSet: "shadcn"
      }
    };
    const out = renderDeveloperUserTurn("build", artifact);
    expect(out).toMatch(/2-4 supporting sections|hero.*features.*footer/i);
  });

  it("adds radix-bare guidance when componentSet === 'radix-bare'", () => {
    const artifact = {
      selectedTokens: {
        palette: { primary: "#000" },
        componentSet: "radix-bare"
      },
      selectedLayoutDirective: "Hero. Menu. Footer."
    };
    const out = renderDeveloperUserTurn("build", artifact);
    expect(out).toContain("radix-bare");
    expect(out).toMatch(/raw Tailwind|lucide.*framer-motion|framer-motion.*lucide/i);
    expect(out).toMatch(/do not.*shadcn|don't.*shadcn/i);
  });
});

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
