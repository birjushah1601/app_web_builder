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

interface PyrightDiagnostic {
  file?: unknown;
  severity?: unknown;
  message?: unknown;
  range?: { start?: { line?: unknown; character?: unknown } };
}

/**
 * Parse `pyright --outputjson` output. Never throws — returns `[]` on
 * malformed JSON or shapes that don't match.
 */
export function parsePyrightJson(stdout: string): BuildError[] {
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch { return []; }
  if (typeof raw !== "object" || raw === null) return [];
  const diags = (raw as { generalDiagnostics?: unknown }).generalDiagnostics;
  if (!Array.isArray(diags)) return [];

  const out: BuildError[] = [];
  for (const d of diags as PyrightDiagnostic[]) {
    const file = typeof d.file === "string" ? d.file : "?";
    const severity = d.severity === "warning" ? "warning" : "error";
    const message = typeof d.message === "string" ? d.message : "(no message)";
    const lineRaw = d.range?.start?.line;
    const colRaw = d.range?.start?.character;
    const line = typeof lineRaw === "number" ? lineRaw + 1 : 0;
    const col = typeof colRaw === "number" ? colRaw + 1 : 0;
    out.push({ file, line, col, severity, message });
  }
  return out;
}
