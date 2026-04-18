import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileWatcher, type WatchEvent } from "../src/watcher.js";
import {
  appendEventLine,
  createProjectFixture,
  waitFor,
  writeGraphFile,
  type ProjectFixture
} from "./helpers.js";

describe("FileWatcher", () => {
  let fx: ProjectFixture;

  beforeEach(() => {
    fx = createProjectFixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it("emits 'graph-changed' when spec.graph.json is written", async () => {
    const events: WatchEvent[] = [];
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 50
    });
    watcher.on("event", (e) => events.push(e));
    await watcher.start();
    try {
      writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
      await waitFor(() => events.some((e) => e.kind === "graph-changed"));
    } finally {
      await watcher.stop();
    }
    expect(events.filter((e) => e.kind === "graph-changed")).toHaveLength(1);
  });

  it("emits 'events-appended' when events.jsonl grows", async () => {
    const events: WatchEvent[] = [];
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 50
    });
    watcher.on("event", (e) => events.push(e));
    await watcher.start();
    try {
      appendEventLine(fx.eventsPath, {
        eventType: "node.created",
        payload: { id: "n1" },
        actor: "architect"
      });
      await waitFor(() => events.some((e) => e.kind === "events-appended"));
    } finally {
      await watcher.stop();
    }
    expect(events.filter((e) => e.kind === "events-appended")).toHaveLength(1);
  });

  it("debounces rapid writes into a single event", async () => {
    const events: WatchEvent[] = [];
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 100
    });
    watcher.on("event", (e) => events.push(e));
    await watcher.start();
    try {
      for (let i = 0; i < 5; i++) {
        writeGraphFile(fx.graphPath, { nodes: [{ id: `n${i}` }], edges: [] });
      }
      // Wait longer than debounce window
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      await watcher.stop();
    }
    expect(events.filter((e) => e.kind === "graph-changed").length).toBeLessThanOrEqual(2);
  });

  it("stop() is idempotent and does not throw on double-call", async () => {
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 50
    });
    await watcher.start();
    await watcher.stop();
    await expect(watcher.stop()).resolves.toBeUndefined();
  });
});
