"use client";

/**
 * Plan #15 — Client-side renderer for the spec_events viewer. Owns the
 * "which row is expanded" state so a row click can toggle a pretty-printed
 * payload underneath. The Refresh button just calls router.refresh() —
 * Next.js re-runs the parent Server Component's data query, which is
 * cheaper than wiring an SSE stream for what is fundamentally an audit
 * log surface.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProjectEventRow } from "@/lib/events/listProjectEvents";

interface Props {
  events: ProjectEventRow[];
}

const SUMMARY_LENGTH = 80;

export function EventsTable({ events }: Props) {
  const [expandedSeq, setExpandedSeq] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div data-testid="events-viewer" className="flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div className="text-sm font-medium text-slate-700">
          Event log
          <span className="ml-2 text-xs font-normal text-slate-500">
            ({events.length} {events.length === 1 ? "event" : "events"}, newest first)
          </span>
        </div>
        <button
          type="button"
          data-testid="events-refresh"
          onClick={refresh}
          disabled={isPending}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isPending ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {events.length === 0 ? (
        <div
          data-testid="events-empty"
          className="px-4 py-8 text-center text-sm text-slate-500"
        >
          No events recorded for this project yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            data-testid="events-table"
            className="w-full border-collapse text-xs"
          >
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="border-b border-slate-200 px-3 py-1.5 text-left font-medium">seq</th>
                <th className="border-b border-slate-200 px-3 py-1.5 text-left font-medium">ts</th>
                <th className="border-b border-slate-200 px-3 py-1.5 text-left font-medium">event_type</th>
                <th className="border-b border-slate-200 px-3 py-1.5 text-left font-medium">role</th>
                <th className="border-b border-slate-200 px-3 py-1.5 text-left font-medium">summary</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => {
                const isOpen = expandedSeq === evt.seq;
                const payloadJson = JSON.stringify(evt.payload);
                const summary = payloadJson.length > SUMMARY_LENGTH
                  ? `${payloadJson.slice(0, SUMMARY_LENGTH)}…`
                  : payloadJson;
                return (
                  <FragmentRow
                    key={evt.seq}
                    evt={evt}
                    isOpen={isOpen}
                    summary={summary}
                    onToggle={() => setExpandedSeq(isOpen ? null : evt.seq)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  evt,
  isOpen,
  summary,
  onToggle
}: {
  evt: ProjectEventRow;
  isOpen: boolean;
  summary: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        data-testid={`events-row-${evt.seq}`}
        onClick={onToggle}
        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
      >
        <td className="px-3 py-1.5 font-mono text-slate-500">{evt.seq}</td>
        <td className="px-3 py-1.5 font-mono text-slate-500">{evt.ts}</td>
        <td className="px-3 py-1.5 font-mono font-medium text-slate-800">{evt.eventType}</td>
        <td className="px-3 py-1.5 font-mono text-slate-700">{evt.role || "—"}</td>
        <td className="px-3 py-1.5 font-mono text-slate-600">{summary}</td>
      </tr>
      {isOpen && (
        <tr data-testid={`events-row-payload-${evt.seq}`}>
          <td colSpan={5} className="border-b border-slate-200 bg-slate-50 px-3 py-2">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-slate-800">
              {JSON.stringify(evt.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
