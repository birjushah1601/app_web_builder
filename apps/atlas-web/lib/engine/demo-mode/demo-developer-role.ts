import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { CANNED_DEMO_DIFF, CANNED_DEMO_SUMMARY } from "./canned-diff";

/**
 * Plan Q — DemoDeveloperRole. Replaces DeveloperRole when
 * ATLAS_FF_DEMO_MODE is on. Returns the canned TODO-app diff so:
 *
 *   - Engine's start() captures `developerOutput.diff` from the role's
 *     `diff: { kind: "patch", body }` return.
 *   - Plan C's sandboxApplier writes the file to E2B → Plan F's HMR
 *     iframe refreshes within ~3s → user sees the live TODO app.
 *   - Plan I gates (security, accessibility) dispatch on the canned diff.
 *   - Plan L auto-fix loop runs if a gate fails (will retry up to 2 times
 *     with the same canned diff — bounded, costless).
 *
 * Emits `developer.completed` with the canned summary.
 */
export class DemoDeveloperRole implements Role {
  readonly id = "developer";

  async run(_inv: RoleInvocation): Promise<RoleOutput> {
    return {
      events: [
        {
          eventType: "developer.completed",
          payload: { summary: CANNED_DEMO_SUMMARY, diff: CANNED_DEMO_DIFF, demo: true }
        }
      ],
      diff: { kind: "patch", body: CANNED_DEMO_DIFF }
    };
  }
}
