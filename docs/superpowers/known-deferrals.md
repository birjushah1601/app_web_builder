# Known Deferrals

Engineering work that was consciously deferred during Phase A — tracked here so we don't forget. Each entry has a **trigger** (what condition makes us revisit) and an **owner-of-revisit** (who should pick it up).

This list is a complement to PRD §21 (which covers strategic risks); items here are tactical engineering follow-ups, not strategic uncertainties.

---

## D1. E.5 Playwright e2e tests parse but don't actually run

**What:** The Playwright test suites authored in plan E.5 are syntactically valid but no run has executed them against the live atlas-web app. The CI workflow that would invoke them does not exist.

**Why deferred:** Requires (a) a CI environment with Clerk test-mode credentials, (b) a Postgres instance reachable from the runner, (c) a working E2B sandbox stub or fixture, (d) a Next.js dev server boot in the CI step. None of these were available at Phase A close.

**Risk if left:** Regressions in the ritual UI go undetected. The existing unit tests cover the components in isolation but not end-to-end flow.

**Trigger to revisit:** Either (a) when CI pipeline authoring lands in Phase B (likely first item), or (b) when a regression escapes to a beta tester.

**Owner-of-revisit:** Whoever takes the first Phase B "wire CI" task.

---

## D2. Postgres test flakiness in spec-graph-sync, spec-graph-ops, spec-graph-merge-driver

**What:** Periodic test failures in these three packages, observed across multiple branches during Phase A. Symptoms include connection reset errors, advisory-lock timeouts, and occasional row-version mismatches.

**Why deferred:** Each failure was reproducible only intermittently, and none blocked a merge (re-run usually passed). Root-causing required dedicated time we didn't have during plan execution.

**Risk if left:** Hides real concurrency bugs. CI signal becomes noisy and developers learn to ignore failures.

**Trigger to revisit:** Either (a) flake rate exceeds 1-in-5 runs on main, or (b) a real concurrency bug ships to production.

**Owner-of-revisit:** Owner of the package where the next confirmed failure lands. Suggested first investigation: connection-pool config + transaction-isolation level in test setup.

---

## D3. ESLint warning in atlas-web for `eslint-config-next/core-web-vitals`

**What:** Cosmetic ESLint warning during atlas-web lint, originating from a config-resolution edge case in `eslint-config-next`.

**Why deferred:** Cosmetic only; lint passes overall. Fix requires either a Next.js minor bump or a workaround in `.eslintrc`.

**Risk if left:** None functionally. New developers may waste time chasing the warning.

**Trigger to revisit:** Next time atlas-web's Next.js version is bumped, or when a developer files an issue about it.

**Owner-of-revisit:** atlas-web maintainer.

---

## D4. drizzle-kit migrate hangs on Windows

**What:** `pnpm db:migrate` (and `npx drizzle-kit migrate`) hang indefinitely against the local Docker Postgres on Windows. Migrations 0004, 0005, 0006 had to be applied via direct psql / a one-off `pg.Pool` script.

**Why deferred:** Workaround exists (manual `psql < migration.sql`); investigating drizzle-kit internals on Windows wasn't worth blocking other work.

**Risk if left:** New team members on Windows hit the same wall. New migrations need manual application until fixed.

**Trigger to revisit:** Either (a) drizzle-kit ships a Windows-related bugfix in a future release, or (b) a new team member trips on it.

**Owner-of-revisit:** Whoever next runs into it. Workaround pattern is well-established now.

---

## D5. Skill-library OSS publish workflow not yet exercised end-to-end

**What:** Plan C.2 authored the GitHub Action that publishes `packages/skill-library/` to a public mirror on tag-push. The workflow has never run because no public mirror repo exists yet.

**Why deferred:** Creating the public `github.com/atlas-labs/atlas-skills` repo + setting up the deploy key + cutting the first tag is gated on the broader OSS launch decision (PRD §22.2 — "Public launch at Phase B close").

**Risk if left:** None until OSS launch. Workflow may have bugs that only surface on first real run.

**Trigger to revisit:** When the OSS launch decision is made (Phase B close per current roadmap).

**Owner-of-revisit:** Whoever owns the OSS launch.

---

## D6. SpendReader exists but no spend events are recorded yet

**What:** `SandboxSpendRepo.record()` is implemented and wired into atlas-web's factory, but nothing in the codebase calls `record()` after a sandbox provision. The cap check therefore always sees 0 spend.

**Why deferred:** Recording spend requires either polling E2B's billing API (rate-limited, no real-time hook) or instrumenting the lifecycle.terminate path with a duration estimate. Neither was scoped into E.4.

**Risk if left:** Spend cap is non-functional in practice. A runaway project could accumulate real E2B charges with no cap enforcement.

**Trigger to revisit:** Before atlas-web admits real (non-internal) users, OR when E2B billing API integration is scoped.

**Owner-of-revisit:** Whoever owns the next sandbox-related plan (likely a Phase B "billing + cap enforcement" unit).

---

## How to use this file

- **When picking up a deferral:** delete its section once the work merges. Don't leave "completed" entries; this file is current state, not history.
- **When deferring something new:** append a section using the same template. Be explicit about the trigger — "someday" is not a trigger.
- **When reviewing the file:** if a deferral has been here > 6 months and no trigger has fired, that's a signal to either action it or accept it as permanent (and remove it).
