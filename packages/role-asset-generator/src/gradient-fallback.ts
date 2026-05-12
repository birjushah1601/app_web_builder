import type { AssetManifest, AssetGenInput } from "./types.js";

/**
 * Synchronous gradient-fallback manifest. Empty URLs signal "use
 * design-tokens.json gradient" to the Developer renderer. The role uses
 * this whenever both ai-image and unsplash paths are disabled or fail.
 */
export function gradientFallback(_input: AssetGenInput): AssetManifest {
  return {
    hero: { slot: "hero", url: "", alt: "Hero gradient" },
    sections: [
      { slot: "feature-1", url: "", alt: "Section 1" },
      { slot: "feature-2", url: "", alt: "Section 2" }
    ]
  };
}
