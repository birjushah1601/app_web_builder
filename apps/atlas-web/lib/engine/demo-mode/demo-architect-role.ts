import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";

/**
 * Plan Q — DemoArchitectRole. Replaces ArchitectRole when ATLAS_FF_DEMO_MODE
 * is on. Returns a deterministic "new-app" artifact that the engine's chain
 * logic accepts (artifact present + non-cosmetic edit class → developer
 * dispatch fires next), so the full ritual UX runs end-to-end without an
 * LLM call.
 *
 * Emits the same event types as the real architect role so that
 * `<RitualTimeline />` (Plan E + P) progresses the architect row through
 * `started → completed` identically.
 */
export class DemoArchitectRole implements Role {
  readonly id = "architect";

  async run(_inv: RoleInvocation): Promise<RoleOutput> {
    const artifact = {
      scope: "new-app",
      specGraph: { nodes: [], edges: [] },
      runnablePlan: {
        tasks: [
          { id: "t1", title: "Scaffold a single-page TODO app", description: "src/app/page.tsx with useState + add/delete" }
        ]
      },
      // graphSlice is injected post-hoc by the architect's deep-plan enricher
      // in the real path; we mirror the same shape here so downstream consumers
      // (ChatPanel's ArchitectPlanCard) render the same way.
      graphSlice: { hash: "sha256:demo-mode-canned", bytes: "{}" }
    };
    return {
      events: [
        { eventType: "architect.pass1.completed", payload: { passed: true, scope: "new-app", demo: true } },
        { eventType: "architect.pass2.completed", payload: { scope: "new-app", artifact } }
      ],
      diff: { kind: "none" }
    };
  }
}
