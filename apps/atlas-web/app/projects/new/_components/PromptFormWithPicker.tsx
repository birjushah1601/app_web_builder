"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PromptForm } from "./PromptForm";
import { WorkflowPickerChecklist } from "@/components/workflow/WorkflowPickerChecklist";
import { classifyAndCreateProject } from "@/lib/actions/classifyAndCreateProject";
import { startWorkflow } from "@/lib/actions/startWorkflow";
import { startRitual } from "@/lib/actions/startRitual";

interface ClassifyVerdict {
  projectId: string;
  mode: "ritual" | "workflow";
  suggestedKinds: string[];
  reasoning: string;
}

export interface PromptFormWithPickerProps {
  /** Plan UXO Task 6 forwarding — propagates the reference-input flag into
   *  the inner PromptForm. Default OFF to keep the no-arg `<PromptFormWithPicker />`
   *  usage in tests / pages where the flag isn't relevant. */
  referenceInputEnabled?: boolean;
}

/**
 * Plan G Task 9 — client wrapper around PromptForm that classifies the prompt
 * first, then either:
 *   - mode=ritual: kicks off startRitual + navigates to canvas (today's UX)
 *   - mode=workflow: renders WorkflowPickerChecklist so the user can confirm/
 *     adjust the suggested kind list. On confirm → startWorkflow + navigate
 *     to the workflow page. On downgrade → startRitual + canvas.
 *
 * Includes an optional cost-cap input (USD) that's threaded into
 * startWorkflow.costCapUsd when set — leaves it unset for ritual mode (cost
 * caps are workflow-engine-scoped today; rituals don't honor them yet).
 */
export function PromptFormWithPicker({
  referenceInputEnabled = false
}: PromptFormWithPickerProps = {}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [verdict, setVerdict] = React.useState<ClassifyVerdict | null>(null);
  const [prompt, setPrompt] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [costCapInput, setCostCapInput] = React.useState<string>("");

  const parseCostCap = (): number | undefined => {
    const trimmed = costCapInput.trim();
    if (trimmed.length === 0) return undefined;
    const n = Number.parseFloat(trimmed);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
  };

  const onSubmit = (formData: FormData): void => {
    setError(null);
    const p = String(formData.get("prompt") ?? "").trim();
    setPrompt(p);
    startTransition(async () => {
      try {
        const r = await classifyAndCreateProject(formData);
        if (r.mode === "workflow") {
          setVerdict(r);
        } else {
          // Ritual mode — start immediately + redirect to canvas. Mirrors
          // submitPromptedProject's flow but without the redirect() since
          // we're in a client transition.
          await startRitual({
            projectId: r.projectId,
            userTurn: p,
            editClass: "structural"
          });
          router.push(`/projects/${r.projectId}/canvas`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onConfirmPicker = (kinds: string[]): void => {
    if (!verdict) return;
    setError(null);
    const costCapUsd = parseCostCap();
    startTransition(async () => {
      try {
        const { workflowRunId } = await startWorkflow({
          projectId: verdict.projectId,
          prompt,
          suggestedKinds: kinds,
          ...(costCapUsd !== undefined ? { costCapUsd } : {})
        });
        router.push(`/projects/${verdict.projectId}/workflow/${workflowRunId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onDowngrade = (): void => {
    if (!verdict) return;
    setError(null);
    startTransition(async () => {
      try {
        await startRitual({
          projectId: verdict.projectId,
          userTurn: prompt,
          editClass: "structural"
        });
        router.push(`/projects/${verdict.projectId}/canvas`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  if (verdict) {
    return (
      <div
        data-testid="prompt-form-with-picker"
        className="mx-auto max-w-2xl space-y-4 p-8"
      >
        <WorkflowPickerChecklist
          suggestedKinds={verdict.suggestedKinds}
          reasoning={verdict.reasoning}
          onConfirm={onConfirmPicker}
          onDowngrade={onDowngrade}
          pending={pending}
        />
        {error && (
          <div
            data-testid="prompt-form-with-picker-error"
            className="text-sm text-red-700"
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="prompt-form-with-picker">
      <PromptForm action={onSubmit} referenceInputEnabled={referenceInputEnabled} />
      <div className="mx-auto -mt-4 max-w-2xl px-8 pb-4">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span>Cost cap (USD, optional)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            data-testid="prompt-form-cost-cap-input"
            value={costCapInput}
            onChange={(e) => setCostCapInput(e.target.value)}
            placeholder="e.g. 5.00"
            className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          />
        </label>
      </div>
      {error && (
        <div
          data-testid="prompt-form-with-picker-error"
          className="mx-auto max-w-2xl px-8 pb-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </div>
  );
}
