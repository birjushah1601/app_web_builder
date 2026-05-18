"use client";

/**
 * useResearcherBrief — React adapter that walks the live event stream
 * (Plan E.0's EventSourceProvider via useEventStream) and folds every
 * `researcher.brief.completed` event into a per-ritualId map of the
 * latest brief payload. Components render the resulting brief in the
 * RitualTimeline (Plan S.2 surface).
 *
 * Why per-ritualId (vs. "the latest brief"): a single SSE stream covers
 * one project but many rituals (a refine kicks off a child ritual; the
 * auto-fix loop spawns more). Storing by ritualId means callers can pick
 * the brief that belongs to whatever ritual they are currently rendering
 * without guessing from event ordering.
 *
 * The hook itself does NOT validate the payload against the InspirationBrief
 * Zod schema — the conductor already published the role's emission and the
 * UI tolerates partial data (missing fields just render nothing). Wrapping
 * a Zod parse here would couple this layer to @atlas/role-researcher, which
 * the task spec explicitly forbids.
 */

import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

/** A single inspiration reference inside a brief. Mirrors the
 *  ReferenceSchema shape from @atlas/role-researcher without importing
 *  it (the package's Zod schemas drag in a server-only dependency
 *  graph). The renderer treats every field as optional except `name`
 *  and `why`, which the schema marks required upstream. */
export interface BriefReference {
  name: string;
  url?: string;
  why: string;
  sourceTier?: "local-catalog" | "web";
  palettePreview?: string[];
  typographyPreview?: {
    primary: string;
    secondary?: string;
  };
}

/** The InspirationBrief payload as it arrives on the wire. Mirrors
 *  InspirationBriefSchema from @atlas/role-researcher. */
export interface BriefPayload {
  category: string;
  audienceCues: string[];
  references: BriefReference[];
  patternsThatWin: string[];
  patternsThatLose: string[];
}

export interface UseResearcherBriefResult {
  briefByRitualId: Record<string, BriefPayload>;
}

/** Normalise the payload into a BriefPayload shape. Returns null when
 *  the event payload is malformed (missing brief object, wrong types,
 *  etc.) so the reducer below can drop the event silently. */
function extractBrief(payload: Record<string, unknown>): BriefPayload | null {
  // Researcher role emits { brief, fastMode } and the conductor wraps the
  // payload with { attempt, roleId }, so the brief lives at payload.brief.
  const raw = payload.brief;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const category = typeof obj.category === "string" ? obj.category : null;
  if (!category) return null;

  const audienceCues = Array.isArray(obj.audienceCues)
    ? obj.audienceCues.filter((c): c is string => typeof c === "string")
    : [];
  const references = Array.isArray(obj.references)
    ? obj.references
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => normaliseReference(r))
        .filter((r): r is BriefReference => r !== null)
    : [];
  const patternsThatWin = Array.isArray(obj.patternsThatWin)
    ? obj.patternsThatWin.filter((p): p is string => typeof p === "string")
    : [];
  const patternsThatLose = Array.isArray(obj.patternsThatLose)
    ? obj.patternsThatLose.filter((p): p is string => typeof p === "string")
    : [];

  return { category, audienceCues, references, patternsThatWin, patternsThatLose };
}

function normaliseReference(r: Record<string, unknown>): BriefReference | null {
  const name = typeof r.name === "string" ? r.name : null;
  const why = typeof r.why === "string" ? r.why : null;
  if (!name || !why) return null;

  const ref: BriefReference = { name, why };
  if (typeof r.url === "string") ref.url = r.url;
  if (r.sourceTier === "local-catalog" || r.sourceTier === "web") ref.sourceTier = r.sourceTier;
  if (Array.isArray(r.palettePreview)) {
    const palette = r.palettePreview.filter((c): c is string => typeof c === "string");
    if (palette.length > 0) ref.palettePreview = palette;
  }
  if (r.typographyPreview && typeof r.typographyPreview === "object") {
    const tp = r.typographyPreview as Record<string, unknown>;
    if (typeof tp.primary === "string") {
      const typography: { primary: string; secondary?: string } = { primary: tp.primary };
      if (typeof tp.secondary === "string") typography.secondary = tp.secondary;
      ref.typographyPreview = typography;
    }
  }
  return ref;
}

/** Subscribe to the ambient event stream and return a per-ritualId map
 *  of the latest researcher brief. Pure fold over the events array (no
 *  side effects) so it plays well with React strict mode. */
export function useResearcherBrief(): UseResearcherBriefResult {
  const { events } = useEventStream();

  const briefByRitualId = useMemo(() => {
    const out: Record<string, BriefPayload> = {};
    for (const evt of events) {
      if (evt.type !== "researcher.brief.completed") continue;
      const brief = extractBrief(evt.payload);
      if (!brief) continue;
      out[evt.ritualId] = brief;
    }
    return out;
  }, [events]);

  return { briefByRitualId };
}
