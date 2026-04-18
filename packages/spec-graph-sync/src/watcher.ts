import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";

export type WatchEventKind =
  | "graph-changed"
  | "events-appended"
  | "graph-removed"
  | "events-removed";

export interface WatchEvent {
  kind: WatchEventKind;
  path: string;
  at: number;
}

export interface FileWatcherOptions {
  graphPath: string;
  eventsPath: string;
  debounceMs: number;
}

type Listener = (event: WatchEvent) => void;

/**
 * Thin chokidar wrapper that emits typed `WatchEvent`s for the two tracked
 * files with a per-file debounce window. The debounce collapses bursts of
 * writes (editor atomic-save patterns, rapid programmatic appends) into
 * single emitted events.
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private stopped = false;

  constructor(private readonly opts: FileWatcherOptions) {
    super();
  }

  async start(): Promise<void> {
    const watcher = chokidar.watch([this.opts.graphPath, this.opts.eventsPath], {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 30,
        pollInterval: 10
      }
    });
    this.watcher = watcher;

    const schedule = (kind: WatchEventKind, path: string) => {
      const key = `${kind}:${path}`;
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.debounceTimers.delete(key);
        if (this.stopped) return;
        this.emit("event", { kind, path, at: Date.now() } satisfies WatchEvent);
      }, this.opts.debounceMs);
      this.debounceTimers.set(key, timer);
    };

    watcher.on("add", (path) => {
      if (path === this.opts.graphPath) schedule("graph-changed", path);
      else if (path === this.opts.eventsPath) schedule("events-appended", path);
    });
    watcher.on("change", (path) => {
      if (path === this.opts.graphPath) schedule("graph-changed", path);
      else if (path === this.opts.eventsPath) schedule("events-appended", path);
    });
    watcher.on("unlink", (path) => {
      if (path === this.opts.graphPath) schedule("graph-removed", path);
      else if (path === this.opts.eventsPath) schedule("events-removed", path);
    });

    await new Promise<void>((resolve, reject) => {
      watcher.once("ready", () => resolve());
      watcher.once("error", reject);
    });
  }

  override on(event: "event", listener: Listener): this;
  override on(event: string, listener: (...args: unknown[]) => void): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
