/**
 * Known sandbox template names. Mirrored from
 * `apps/atlas-web/lib/sandbox/template-router.ts` — the source of truth for
 * which templates Atlas's sandbox factory can route to today. When a new
 * template is added there, add it here (and a build command below). The
 * registry-completeness test in test/commands.test.ts asserts this union and
 * BUILD_COMMANDS stay in lock-step.
 *
 * `@atlas/sandbox-e2b`'s `TemplateId` is intentionally `z.string().min(1)`
 * (any non-empty string) for runtime flexibility, so we cannot import a
 * literal union from there. This local union is bonus type coverage; the
 * runtime invariant comes from BuildGateRole returning errorKind:
 * "unsupported_stack" when the template isn't in BUILD_COMMANDS.
 */
export type KnownTemplate =
  | "atlas-next-ts"
  | "atlas-next-ts-v2"
  | "atlas-fastapi"
  | "atlas-dlt-python"
  | "atlas-graphql-yoga"
  | "atlas-bun-cli"
  | "atlas-expo-rn"
  | "atlas-hono-bun";

export type ParserId = "tsc" | "pyright";

export interface BuildCommand {
  /** Shell command run inside the sandbox via SandboxExec. */
  exec: string;
  /** Which parser normalizes stdout/stderr into BuildReport.errors. */
  parser: ParserId;
  /** Hard kill threshold; on hit, BuildGateRole emits errorKind: "timeout". */
  timeoutMs: number;
}

/**
 * Per-template registry. `Record<KnownTemplate, BuildCommand>` makes
 * TypeScript fail compilation the moment a name is added to KnownTemplate
 * without a matching entry, and vice versa. The completeness test in
 * test/commands.test.ts is the spec-canonical enforcement of invariant §1.4.
 */
export const BUILD_COMMANDS: Record<KnownTemplate, BuildCommand> = {
  "atlas-next-ts":      { exec: "pnpm exec tsc --noEmit",           parser: "tsc",     timeoutMs: 60000 },
  "atlas-next-ts-v2":   { exec: "pnpm exec tsc --noEmit",           parser: "tsc",     timeoutMs: 60000 },
  "atlas-fastapi":      { exec: "python -m pyright --outputjson .", parser: "pyright", timeoutMs: 60000 },
  "atlas-dlt-python":   { exec: "python -m pyright --outputjson .", parser: "pyright", timeoutMs: 60000 },
  "atlas-graphql-yoga": { exec: "bun run tsc --noEmit",             parser: "tsc",     timeoutMs: 60000 },
  "atlas-bun-cli":      { exec: "bun run tsc --noEmit",             parser: "tsc",     timeoutMs: 60000 },
  "atlas-expo-rn":      { exec: "pnpm exec tsc --noEmit",           parser: "tsc",     timeoutMs: 60000 },
  "atlas-hono-bun":     { exec: "bun run tsc --noEmit",             parser: "tsc",     timeoutMs: 60000 }
};
