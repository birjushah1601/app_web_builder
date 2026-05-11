import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { statSync } from "node:fs";
import type { Pool } from "pg";
import { SpecEventRepo, SpecGraphRepo } from "@atlas/spec-graph-data";
import { FileWatcher, type WatchEvent } from "./watcher.js";
import { WriteTokenRegistry } from "./write-token.js";
import { ingestNewEventLines, syncGraphFileToMirror, type FileToMirrorState } from "./file-to-mirror.js";
import { reconcileEventsJsonl, writeGraphFromMirror } from "./mirror-to-file.js";
import {
  syncFeedbackLoopsAvoided,
  syncInvalidLinesTotal,
  syncPropagationDuration,
  syncReconciliationNeeded,
  syncWatchEvents,
  withSyncSpan
} from "./observability.js";

export interface SyncDaemonOptions {
  projectId: string;
  projectDir: string;
  pool: Pool;
  debounceMs?: number;
  writeTokenTtlMs?: number;
}

export interface StartOptions {
  regenerateOnStartup?: boolean;
}

export class SyncDaemon {
  private readonly graphPath: string;
  private readonly eventsPath: string;
  private readonly tokens: WriteTokenRegistry;
  private readonly graphRepo: SpecGraphRepo;
  private readonly eventRepo: SpecEventRepo;
  private readonly state: FileToMirrorState;
  private watcher: FileWatcher | null = null;
  private started = false;
  private gcInterval: NodeJS.Timeout | null = null;

  constructor(private readonly opts: SyncDaemonOptions) {
    const atlasDir = join(opts.projectDir, ".atlas");
    this.graphPath = join(atlasDir, "spec.graph.json");
    this.eventsPath = join(atlasDir, "events.jsonl");
    this.tokens = new WriteTokenRegistry({ ttlMs: opts.writeTokenTtlMs ?? 5_000 });
    this.graphRepo = new SpecGraphRepo(opts.pool);
    this.eventRepo = new SpecEventRepo(opts.pool);
    this.state = { eventsFileOffset: 0 };
  }

  async start(opts: StartOptions = {}): Promise<void> {
    if (this.started) return;
    // Initialise offset to current file size so startup backfill is not treated as "new"
    try {
      this.state.eventsFileOffset = statSync(this.eventsPath).size;
    } catch {
      this.state.eventsFileOffset = 0;
    }

    // Startup: reconcile events file from mirror, regenerate graph file if asked
    await reconcileEventsJsonl({
      projectId: this.opts.projectId,
      eventsPath: this.eventsPath,
      eventRepo: this.eventRepo,
      tokens: this.tokens
    });
    // Re-stat after reconcile so we don't re-ingest what we just wrote
    try {
      this.state.eventsFileOffset = statSync(this.eventsPath).size;
    } catch {
      /* ignore */
    }
    if (opts.regenerateOnStartup) {
      await writeGraphFromMirror({
        projectId: this.opts.projectId,
        graphPath: this.graphPath,
        graphRepo: this.graphRepo,
        tokens: this.tokens
      });
    }

    this.watcher = new FileWatcher({
      graphPath: this.graphPath,
      eventsPath: this.eventsPath,
      debounceMs: this.opts.debounceMs ?? 100
    });
    this.watcher.on("event", (e) => void this.handle(e));
    await this.watcher.start();
    this.gcInterval = setInterval(() => this.tokens.gc(), 1_000);
    this.started = true;

    // eslint-disable-next-line no-console
    console.log(
      `[atlas-sync] watching project=${this.opts.projectId} dir=${this.opts.projectDir} graph=${this.graphPath} events=${this.eventsPath}`
    );
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.gcInterval) clearInterval(this.gcInterval);
    this.gcInterval = null;
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }
  }

  private async handle(event: WatchEvent): Promise<void> {
    syncWatchEvents.inc({ direction: "file-to-mirror", kind: event.kind });

    // Feedback-loop guard: ignore events matching a recent write token
    try {
      const content = await readFile(event.path, "utf8");
      const hash = createHash("sha256").update(content).digest("hex");
      if (this.tokens.wasWrittenByUs(event.path, hash)) {
        syncFeedbackLoopsAvoided.inc();
        return;
      }
    } catch {
      /* if file read fails we still proceed — downstream handler will see it */
    }

    const timer = syncPropagationDuration.startTimer({ direction: "file-to-mirror" });
    try {
      await withSyncSpan(
        "SyncDaemon.propagateFileToMirror",
        { "atlas.project_id": this.opts.projectId, "atlas.sync.kind": event.kind },
        async () => {
          if (event.kind === "events-appended") {
            const result = await ingestNewEventLines({
              projectId: this.opts.projectId,
              eventsPath: this.eventsPath,
              state: this.state,
              eventRepo: this.eventRepo
            });
            if (result.invalid > 0) syncInvalidLinesTotal.inc(result.invalid);
          } else if (event.kind === "graph-changed") {
            try {
              await syncGraphFileToMirror({
                projectId: this.opts.projectId,
                graphPath: this.graphPath,
                graphRepo: this.graphRepo,
                eventRepo: this.eventRepo
              });
            } catch (err) {
              if ((err as Error).message.startsWith("reconciliation-needed")) {
                syncReconciliationNeeded.inc();
                // eslint-disable-next-line no-console
                console.warn(`[atlas-sync] reconciliation-needed: ${(err as Error).message}`);
                return;
              }
              throw err;
            }
          }
        }
      );
    } finally {
      timer();
    }
  }
}
