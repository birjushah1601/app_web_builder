"use client";
import * as React from "react";

export interface AxisOption {
  id: string;
  name: string;
  swatchSvg: string;
  educationCopy: string;
  funFact: string;
}

export interface Axis {
  id: string;
  label: string;
  educationalTooltip: string;
  options: AxisOption[];
}

export interface AxisWizardProps {
  axes: Axis[];
  onComplete: (selection: Record<string, string>) => void;
}

export function AxisWizard({ axes, onComplete }: AxisWizardProps) {
  const [stepIdx, setStepIdx] = React.useState(0);
  const [selection, setSelection] = React.useState<Record<string, string>>({});
  const axis = axes[stepIdx];
  const isLast = stepIdx === axes.length - 1;
  const currentChoice = selection[axis.id];

  return (
    <div data-testid="axis-wizard" className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Step {stepIdx + 1} of {axes.length}
      </div>
      <h3 className="mb-2 text-lg font-semibold">{axis.label}</h3>
      <p className="mb-4 text-sm text-slate-600">{axis.educationalTooltip}</p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="axis-options">
        {axis.options.map((opt) => {
          const selected = currentChoice === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelection({ ...selection, [axis.id]: opt.id })}
              className={`rounded-md border p-3 text-left transition ${
                selected ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="mb-2" dangerouslySetInnerHTML={{ __html: opt.swatchSvg }} />
              <div className="text-sm font-semibold">{opt.name}</div>
              <div className="mt-1 text-xs text-slate-600">{opt.educationCopy}</div>
              {opt.funFact && <div className="mt-1 text-xs italic text-slate-500">{opt.funFact}</div>}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
          disabled={stepIdx === 0}
          className="rounded-md border border-slate-200 px-4 py-2 text-sm disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!currentChoice}
          onClick={() => {
            if (isLast) onComplete(selection);
            else setStepIdx(stepIdx + 1);
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {isLast ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
