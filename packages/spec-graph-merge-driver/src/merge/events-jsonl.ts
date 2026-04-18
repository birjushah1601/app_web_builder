interface ParsedEvent {
  id: string;
  createdAt: string;
  raw: string;
  original: unknown;
}

function parseLines(content: string): { keyed: ParsedEvent[]; orphans: string[] } {
  const keyed: ParsedEvent[] = [];
  const orphans: string[] = [];
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      orphans.push(trimmed);
      continue;
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "id" in (parsed as Record<string, unknown>) &&
      typeof (parsed as { id: unknown }).id !== "undefined"
    ) {
      const rec = parsed as { id: string | number; createdAt?: string };
      keyed.push({
        id: String(rec.id),
        createdAt: typeof rec.createdAt === "string" ? rec.createdAt : "",
        raw: trimmed,
        original: parsed
      });
    } else {
      orphans.push(trimmed);
    }
  }
  return { keyed, orphans };
}

export function mergeEventsJsonl(base: string, ours: string, theirs: string): string {
  const byId = new Map<string, ParsedEvent>();
  const orphanOrder: string[] = [];
  const seenOrphans = new Set<string>();

  for (const source of [base, ours, theirs]) {
    const { keyed, orphans } = parseLines(source);
    for (const ev of keyed) {
      if (!byId.has(ev.id)) byId.set(ev.id, ev);
    }
    for (const line of orphans) {
      if (!seenOrphans.has(line)) {
        seenOrphans.add(line);
        orphanOrder.push(line);
      }
    }
  }

  const sorted = [...byId.values()].sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });

  const lines = [...sorted.map((e) => e.raw), ...orphanOrder];
  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}
