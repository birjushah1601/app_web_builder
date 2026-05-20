import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  let writes: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("writes structured JSON with level, msg, ts, and extras", () => {
    const log = createLogger({ level: "info" });
    log.info("hello", { path: ".atlas/events.jsonl" });
    expect(writes).toHaveLength(1);
    const entry = JSON.parse(writes[0]!.trim());
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.path).toBe(".atlas/events.jsonl");
    expect(typeof entry.ts).toBe("string");
    expect(() => new Date(entry.ts).toISOString()).not.toThrow();
  });

  it("filters below the configured level", () => {
    const log = createLogger({ level: "warn" });
    log.debug("chatter");
    log.info("still chatter");
    log.warn("real");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).msg).toBe("real");
  });

  it("never writes to stdout (Git protocol)", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = createLogger({ level: "debug" });
    log.error("something broke", { err: "boom" });
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it("reads level from ATLAS_LOG_LEVEL when no option is passed", () => {
    process.env.ATLAS_LOG_LEVEL = "error";
    const log = createLogger();
    log.warn("should be suppressed");
    log.error("should appear");
    delete process.env.ATLAS_LOG_LEVEL;
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).level).toBe("error");
  });
});
