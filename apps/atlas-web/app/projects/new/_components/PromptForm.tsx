// apps/atlas-web/app/projects/new/_components/PromptForm.tsx
"use client";

import * as React from "react";

const PILLS = [
  { value: "frontend-app",     label: "🌐 Website" },
  { value: "backend-rest-api", label: "⚙️ Backend / API" },
  { value: "mobile-app",       label: "📱 Mobile app" },
  { value: "data-pipeline",    label: "📊 Data pipeline" },
  { value: "auto",             label: "🤖 Let AI decide" }
] as const;

type PillValue = (typeof PILLS)[number]["value"];

export interface PromptFormProps {
  action: (formData: FormData) => void | Promise<void>;
}

export function PromptForm({ action }: PromptFormProps) {
  const [kind, setKind] = React.useState<PillValue>("auto");

  return (
    <form action={action} className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-900">What do you want to build?</h1>

      <div className="flex flex-wrap gap-2">
        {PILLS.map((p) => {
          const active = p.value === kind;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(p.value)}
              className={[
                "rounded-full border px-4 py-2 text-sm font-medium transition",
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              ].join(" ")}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <input type="hidden" name="kind" value={kind} />

      <textarea
        name="prompt"
        required
        rows={6}
        placeholder="What do you want to build? e.g. A landing page for my Mumbai spice kitchen with menu + online ordering"
        className="block w-full resize-y rounded-md border border-slate-300 px-4 py-3 text-base focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
      />

      <button
        type="submit"
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-base font-medium text-white hover:bg-slate-700"
      >
        Create
      </button>
    </form>
  );
}
