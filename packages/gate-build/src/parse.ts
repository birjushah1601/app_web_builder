import type { BuildError } from "./schema.js";

/**
 * Parse `tsc --noEmit` output. Each error line has the form:
 *   path(LINE,COL): error|warning TS####: message
 * Anything not matching the pattern is ignored — tsc summary lines, blank
 * lines, etc. Never throws.
 */
export function parseTscOutput(stdout: string): BuildError[] {
  const re = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+: .+)$/;
  const out: BuildError[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    // After .match() with groups 1-5, TypeScript knows all are non-undefined
    out.push({
      file: m[1]!,
      line: Number(m[2]!),
      col: Number(m[3]!),
      severity: m[4]! as "error" | "warning",
      message: m[5]!
    });
  }
  return out;
}
