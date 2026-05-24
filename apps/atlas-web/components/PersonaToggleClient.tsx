"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PersonaToggle } from "./PersonaToggle";
import { setPersonaOverride } from "@/lib/actions/setPersonaOverride";
import type { PersonaTier } from "@atlas/ritual-engine";

/**
 * Client wrapper for `<PersonaToggle />` that wires it to the
 * `setPersonaOverride` Server Action and triggers a router refresh on
 * change so the layout's server-side `prefs.getOverride()` re-runs and
 * the displayed persona + persona-tiered surfaces update.
 *
 * Mounted by `app/projects/[projectId]/layout.tsx` in the topNav. The
 * `current` prop is the persona resolved server-side at request time
 * (override > Clerk publicMetadata defaultPersona > "ama").
 */
export interface PersonaToggleClientProps {
  projectId: string;
  current: PersonaTier;
}

export function PersonaToggleClient({ projectId, current }: PersonaToggleClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = React.useState<PersonaTier>(current);

  // Keep optimistic state in sync with the server's source of truth when
  // it changes (e.g., navigating to a project where a different override
  // was previously set). React 19 useState with a prop initialiser only
  // runs on mount, so a manual sync effect is needed.
  React.useEffect(() => {
    setOptimistic(current);
  }, [current]);

  function handleChange(next: PersonaTier) {
    if (next === optimistic || pending) return;
    // Update local state immediately so the active-pill flips before
    // the server round-trip; if the action throws, revert.
    setOptimistic(next);
    startTransition(async () => {
      try {
        await setPersonaOverride({ projectId, persona: next });
        // router.refresh() re-runs the server component layout so the
        // `Persona: {persona}` display and any persona-tiered renderers
        // pick up the new value without a full page reload.
        router.refresh();
      } catch {
        setOptimistic(current);
      }
    });
  }

  return (
    <span data-testid="persona-toggle-host">
      <PersonaToggle current={optimistic} onChange={handleChange} />
    </span>
  );
}
