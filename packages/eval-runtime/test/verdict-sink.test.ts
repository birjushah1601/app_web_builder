// test/verdict-sink.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryVerdictSink } from "../src/verdict-sink.js";

describe("InMemoryVerdictSink", () => {
  it("collects verdicts", async () => {
    const sink = new InMemoryVerdictSink();
    await sink.write({
      ritualId: "r1", roleId: "architect", projectId: "00000000-0000-0000-0000-000000000001",
      userId: "u", attempt: 1, layer: "structural", passed: true, rubricVersion: "architect@1.0.0"
    });
    expect(sink.verdicts).toHaveLength(1);
    sink.clear();
    expect(sink.verdicts).toHaveLength(0);
  });
});
