"use client";

/**
 * ResearcherBriefCard — collapsible card that renders one InspirationBrief
 * payload inside the RitualTimeline. Slotted between the architect and
 * developer rows so the user can see *why* the developer is about to write
 * what it writes (color palette, font pairings, layout patterns, reference
 * inspirations from the local catalog or the web).
 *
 * Pure presentational. The hook (useResearcherBrief) owns the per-ritualId
 * map; the timeline orchestrator picks one entry and passes it here.
 *
 * Visual style mirrors RitualTimelineRow's expanded detail panel
 * (bg-slate-50, slate-* type, font-medium for labels) so the rail does
 * not feel like two different components stitched together.
 *
 * No shadcn Card import: atlas-web does not ship the shadcn primitives
 * (components/ui/ is empty). A native <details> element delivers the
 * collapsible affordance with zero JS state and the correct keyboard
 * semantics (Space/Enter toggles, focus ring follows).
 */

import type { BriefPayload } from "@/lib/research/useResearcherBrief";

export interface ResearcherBriefCardProps {
  brief: BriefPayload;
  /** ritualId is propagated for parent-controlled keying (e.g. when the
   *  rail wants to remount the card on ritual change) and for test
   *  selectors via data-testid. The component itself does not fetch by
   *  it — the brief is already passed in. */
  ritualId: string;
}

export function ResearcherBriefCard({ brief, ritualId }: ResearcherBriefCardProps) {
  // De-dupe palette swatches across all references so a single chip strip
  // gives the user a project-level palette glance. Order = first-seen.
  const swatches = uniquePreserveOrder(
    brief.references.flatMap((r) => r.palettePreview ?? [])
  );

  // Same for typography — collect every {primary, secondary} pair seen
  // across the references and de-dupe by stringified pair so we don't
  // render "Inter / —" three times for the three references that all
  // chose Inter.
  const typographyPairs = uniqueTypographyPairs(brief.references);

  return (
    <div
      data-testid="researcher-brief-card"
      data-ritual-id={ritualId}
      className="border-t border-slate-200 bg-slate-50 p-4"
    >
      <details>
        <summary className="cursor-pointer select-none text-xs font-medium text-slate-700">
          Researcher brief
          <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-slate-500">
            {brief.category}
          </span>
        </summary>

        <div className="mt-3 space-y-3 text-[11px] text-slate-700">
          {brief.audienceCues.length > 0 && (
            <Section label="Audience">
              <div className="flex flex-wrap gap-1">
                {brief.audienceCues.map((cue) => (
                  <Badge key={cue}>{cue}</Badge>
                ))}
              </div>
            </Section>
          )}

          {swatches.length > 0 && (
            <Section label="Palette">
              <div data-testid="brief-palette" className="flex flex-wrap gap-1.5">
                {swatches.map((hex) => (
                  <span
                    key={hex}
                    title={hex}
                    aria-label={`color swatch ${hex}`}
                    className="inline-block h-5 w-5 rounded-md border border-slate-300"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </Section>
          )}

          {typographyPairs.length > 0 && (
            <Section label="Typography">
              <ul data-testid="brief-typography" className="space-y-0.5">
                {typographyPairs.map((pair, i) => (
                  <li key={`${pair.primary}-${pair.secondary ?? ""}-${i}`}>
                    <span className="font-medium text-slate-800">{pair.primary}</span>
                    {pair.secondary && (
                      <span className="text-slate-500"> / {pair.secondary}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {brief.patternsThatWin.length > 0 && (
            <Section label="Patterns that win">
              <ul data-testid="brief-patterns-win" className="list-disc space-y-0.5 pl-4">
                {brief.patternsThatWin.map((p, i) => (
                  <li key={`${p}-${i}`}>{p}</li>
                ))}
              </ul>
            </Section>
          )}

          {brief.patternsThatLose.length > 0 && (
            <Section label="Patterns that lose">
              <ul data-testid="brief-patterns-lose" className="list-disc space-y-0.5 pl-4 text-slate-500">
                {brief.patternsThatLose.map((p, i) => (
                  <li key={`${p}-${i}`}>{p}</li>
                ))}
              </ul>
            </Section>
          )}

          {brief.references.length > 0 && (
            <Section label="References">
              <ul data-testid="brief-references" className="space-y-1">
                {brief.references.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="flex flex-wrap items-baseline gap-1.5">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-indigo-700 underline-offset-2 hover:underline"
                      >
                        {r.name}
                      </a>
                    ) : (
                      <span className="font-medium text-slate-800">{r.name}</span>
                    )}
                    {r.sourceTier && (
                      <Badge variant={r.sourceTier === "web" ? "info" : "muted"}>
                        {r.sourceTier}
                      </Badge>
                    )}
                    <span className="text-slate-600">— {r.why}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </details>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function Badge({
  children,
  variant = "default"
}: {
  children: React.ReactNode;
  variant?: "default" | "muted" | "info";
}) {
  const base = "inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-medium";
  const cls =
    variant === "info"
      ? `${base} border-indigo-200 bg-indigo-50 text-indigo-800`
      : variant === "muted"
        ? `${base} border-slate-200 bg-white text-slate-600`
        : `${base} border-slate-200 bg-white text-slate-800`;
  return <span className={cls}>{children}</span>;
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function uniqueTypographyPairs(
  references: BriefPayload["references"]
): { primary: string; secondary?: string }[] {
  const seen = new Set<string>();
  const out: { primary: string; secondary?: string }[] = [];
  for (const r of references) {
    if (!r.typographyPreview) continue;
    const key = `${r.typographyPreview.primary}::${r.typographyPreview.secondary ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pair: { primary: string; secondary?: string } = { primary: r.typographyPreview.primary };
    if (r.typographyPreview.secondary !== undefined) {
      pair.secondary = r.typographyPreview.secondary;
    }
    out.push(pair);
  }
  return out;
}
