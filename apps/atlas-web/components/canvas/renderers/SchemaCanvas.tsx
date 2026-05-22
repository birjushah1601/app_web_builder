"use client";

import * as React from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import { selectSchemaDirection } from "@/lib/actions/selectSchemaDirection";
import type { SchemaProposal, SchemaDirection } from "@atlas/role-schema-architect";

export interface SchemaCanvasProps {
  projectId: string;
  ritualId: string;
  persona: "ama" | "diego" | "priya";
}

export function SchemaCanvas({ projectId: _projectId, ritualId, persona }: SchemaCanvasProps) {
  const { events } = useEventStream();
  const proposal = React.useMemo(() => extractLatestProposal(events), [events]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const cards: Array<{ direction: SchemaDirection; isRecommended: boolean }> = React.useMemo(
    () =>
      proposal
        ? [
            { direction: proposal.recommended, isRecommended: true },
            { direction: proposal.alternates[0], isRecommended: false },
            { direction: proposal.alternates[1], isRecommended: false }
          ]
        : [],
    [proposal]
  );

  const selected = React.useMemo(
    () => (selectedId ? cards.find((c) => c.direction.id === selectedId)?.direction ?? null : null),
    [selectedId, cards]
  );

  const handleUseThis = React.useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await selectSchemaDirection({ ritualId, directionId: selected.id, direction: selected });
      setSubmitted(true);
    } catch (err) {
      setError(`Could not select: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }, [selected, ritualId]);

  if (!proposal) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500" data-testid="schema-canvas">
        <p>Waiting for schema proposal…</p>
      </div>
    );
  }

  return (
    <main className="p-6" data-testid="schema-canvas">
      <h2 className="mb-4 text-lg font-semibold">Schema directions</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map(({ direction, isRecommended }) => (
          <button
            key={direction.id}
            type="button"
            data-testid="schema-direction-card"
            onClick={() => setSelectedId(direction.id)}
            className={`rounded-lg border p-4 text-left transition ${
              selectedId === direction.id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"
            }`}
          >
            {isRecommended && (
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-600">Recommended</div>
            )}
            <div className="text-base font-semibold">{direction.name}</div>
            <div className="mt-1 text-sm text-slate-600">{direction.shortDescription}</div>
            <div className="mt-2 text-xs text-slate-500">
              {direction.contract.operations.length} operations · {direction.dataModel.entities.length} entities
            </div>
          </button>
        ))}
      </div>
      {selectedId && selected && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="schema-direction-detail">
          <ContractPane contract={selected.contract} />
          <DataModelPane entities={selected.dataModel.entities} persona={persona} />
          {!submitted && (
            <div className="md:col-span-2 mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleUseThis}
                disabled={submitting}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Selecting…" : "Use this direction"}
              </button>
              {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
            </div>
          )}
          {submitted && (
            <div className="md:col-span-2 mt-2 text-sm text-slate-700" role="status">
              Selected — Developer building…
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function ContractPane({ contract }: { contract: SchemaDirection["contract"] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">Contract</h3>
      {contract.style === "rest" ? (
        <ul className="space-y-1 font-mono text-xs">
          {contract.operations.map((op) => (
            <li key={`${op.method}-${op.path}`}>
              <span className="font-semibold">{op.method}</span> {op.path}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1 font-mono text-xs">
          {contract.operations.map((op) => (
            <li key={`${op.kind}-${op.name}`}>
              <span className="font-semibold">{op.kind}</span> {op.name}: {op.returnType}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DataModelPane({ entities, persona }: { entities: Array<import("@atlas/role-schema-architect").Entity>; persona: "ama" | "diego" | "priya" }) {
  const showAdvanced = persona === "diego" || persona === "priya";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">Data Model</h3>
      <ul className="space-y-3">
        {entities.map((e) => (
          <li key={e.name}>
            <div className="font-mono text-sm font-semibold">{e.name}</div>
            <ul className="ml-3 mt-1 space-y-0.5">
              {e.fields.map((f) => (
                <li key={f.name} className="font-mono text-xs text-slate-600">
                  {f.name} <span className="text-slate-400">{f.type}</span>
                  {showAdvanced && f.nullable === false ? <span className="text-slate-400"> NOT NULL</span> : null}
                </li>
              ))}
            </ul>
            {showAdvanced && e.indexes.length > 0 && (
              <div className="ml-3 mt-1 text-xs text-slate-500">
                {e.indexes.length} index{e.indexes.length === 1 ? "" : "es"}
              </div>
            )}
            {showAdvanced && e.rls.enabled && (
              <div className="ml-3 mt-1 text-xs text-amber-600">RLS · {e.rls.policies.length} polic{e.rls.policies.length === 1 ? "y" : "ies"}</div>
            )}
            {showAdvanced && e.migrationHints.length > 0 && (
              <details className="ml-3 mt-1 text-xs text-slate-500">
                <summary>Migration hints ({e.migrationHints.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {e.migrationHints.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function extractLatestProposal(events: ReadonlyArray<{ type: string; payload: unknown }>): SchemaProposal | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.type === "schema_architect.proposal.emitted") {
      const proposal = (e.payload as { proposal?: SchemaProposal }).proposal;
      if (proposal) return proposal;
    }
  }
  return null;
}
