export interface WriteTokenOptions {
  ttlMs: number;
}

interface Token {
  filePath: string;
  contentHash: string;
  expiresAt: number;
}

/**
 * Tracks content hashes the daemon has just written to disk so that the
 * resulting filesystem event can be ignored (prevents feedback loops).
 *
 * Keyed by (filePath, contentHash). Entries expire after `ttlMs`.
 */
export class WriteTokenRegistry {
  private readonly tokens: Map<string, Token[]> = new Map();

  constructor(private readonly opts: WriteTokenOptions) {}

  register(filePath: string, contentHash: string): void {
    const expiresAt = Date.now() + this.opts.ttlMs;
    const existing = this.tokens.get(filePath) ?? [];
    existing.push({ filePath, contentHash, expiresAt });
    this.tokens.set(filePath, existing);
  }

  wasWrittenByUs(filePath: string, contentHash: string): boolean {
    const entries = this.tokens.get(filePath);
    if (!entries) {
      return false;
    }
    const now = Date.now();
    return entries.some((t) => t.contentHash === contentHash && t.expiresAt > now);
  }

  gc(): void {
    const now = Date.now();
    for (const [filePath, entries] of this.tokens) {
      const live = entries.filter((t) => t.expiresAt > now);
      if (live.length === 0) {
        this.tokens.delete(filePath);
      } else if (live.length !== entries.length) {
        this.tokens.set(filePath, live);
      }
    }
  }

  size(): number {
    let total = 0;
    for (const entries of this.tokens.values()) {
      total += entries.length;
    }
    return total;
  }
}
