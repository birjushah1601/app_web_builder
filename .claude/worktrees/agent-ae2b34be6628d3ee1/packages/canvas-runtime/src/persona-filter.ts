import type { PersonaTier } from "@atlas/ritual-engine";
import type { CanvasManifest } from "./types.js";

/** Returns a manifest narrowed to modes whose audience includes the persona.
 *  Null persona defaults to "ama" (most restrictive). Pure function — input is
 *  not mutated. The returned `modes` array preserves input ordering. */
export function personaFilter(manifest: CanvasManifest, persona: PersonaTier | null): CanvasManifest {
  const effective: PersonaTier = persona ?? "ama";
  return {
    artifactKind: manifest.artifactKind,
    modes: manifest.modes.filter((m) => m.audience.includes(effective))
  };
}
