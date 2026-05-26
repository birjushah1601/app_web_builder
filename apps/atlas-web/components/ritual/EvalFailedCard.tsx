"use client";

// Structural-compatible subset of Verdict from @atlas/eval-runtime.
// We avoid importing the full package (atlas-web doesn't depend on it) and
// only declare the fields the UI reads.
export interface EvalVerdict {
  layer: "structural" | "judge" | "workflow";
  passed: boolean;
  failures?: Array<{ check: string; reason: string }>;
  dimensions?: Array<{ name: string; score: number; rationale: string }>;
}

export function EvalFailedCard({
  roleId,
  layer,
  attempts,
  verdicts,
  onRetryWithEdits,
  onRestart
}: {
  roleId: string;
  layer: "structural" | "judge";
  attempts: number;
  verdicts: EvalVerdict[];
  onRetryWithEdits?: (prefill: string) => void;
  onRestart?: () => void;
}) {
  const last = verdicts[verdicts.length - 1];
  const structuralFailures = last?.failures ?? [];
  const failedDims = (last?.dimensions ?? []).filter((d) => d.score < 6);

  return (
    <div data-testid="eval-failed-card" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs">
      <div className="mb-2 font-semibold text-red-900">
        &#9888; {roleId.charAt(0).toUpperCase() + roleId.slice(1)} output failed quality check
      </div>
      {structuralFailures.length > 0 && (
        <>
          <div className="mb-1 text-red-900">Structural failures:</div>
          <ul className="mb-2 list-disc space-y-1 pl-4 text-red-900">
            {structuralFailures.map((f, i) => (
              <li key={i}><span className="font-mono">{f.check}</span>: {f.reason}</li>
            ))}
          </ul>
        </>
      )}
      {failedDims.length > 0 && (
        <>
          <div className="mb-1 text-red-900">Failed dimensions:</div>
          <ul className="mb-2 list-disc space-y-1 pl-4 text-red-900">
            {failedDims.map((d, i) => (
              <li key={i}><span className="font-mono">{d.name}</span> ({d.score}/10): {d.rationale}</li>
            ))}
          </ul>
        </>
      )}
      <div className="text-red-700">Retry attempted once with feedback. Failed both times.</div>
      <div className="mt-2 flex gap-2">
        {onRetryWithEdits && (
          <button
            onClick={() => onRetryWithEdits(buildPrefill(structuralFailures, failedDims))}
            className="rounded-md bg-red-700 px-2 py-1 text-xs font-medium text-white"
          >
            Retry with my edits
          </button>
        )}
        {onRestart && (
          <button
            onClick={onRestart}
            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-900"
          >
            Edit prompt &amp; restart
          </button>
        )}
      </div>
    </div>
  );
}

function buildPrefill(
  failures: Array<{ check: string; reason: string }>,
  dims: Array<{ name: string; score: number; rationale: string }>
): string {
  const lines = [
    "## What went wrong",
    ...failures.map((f) => `- ${f.check}: ${f.reason}`),
    ...dims.map((d) => `- ${d.name} (${d.score}/10): ${d.rationale}`),
    "",
    "## Refining the prompt to address this:",
    ""
  ];
  return lines.join("\n");
}
