import { describe, expect, it, vi } from "vitest";
import { MockIntentClassifier } from "../src/classifier.js";

describe("MockIntentClassifier", () => {
  it("classifies intent to the first skill whose activate_on contains a matching token", async () => {
    const classifier = new MockIntentClassifier([
      { name: "brainstorm", activate_on: ["brainstorm", "explore"] },
      { name: "tdd-feature", activate_on: ["tdd", "tests"] }
    ]);
    const result = await classifier.classify("I want to brainstorm my app idea");
    expect(result.matches).toContainEqual(expect.objectContaining({ name: "brainstorm" }));
  });

  it("returns empty matches for an unrecognised intent", async () => {
    const classifier = new MockIntentClassifier([
      { name: "brainstorm", activate_on: ["brainstorm"] }
    ]);
    const result = await classifier.classify("deploy to production");
    expect(result.matches).toHaveLength(0);
  });

  it("fires the onClassification telemetry hook with result and latencyMs", async () => {
    const hook = vi.fn();
    const classifier = new MockIntentClassifier(
      [{ name: "brainstorm", activate_on: ["brainstorm"] }],
      { onClassification: hook }
    );
    await classifier.classify("brainstorm an idea");
    expect(hook).toHaveBeenCalledOnce();
    const [result, latencyMs, cacheKey] = hook.mock.calls[0];
    expect(result.matches.length).toBeGreaterThan(0);
    expect(typeof latencyMs).toBe("number");
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof cacheKey).toBe("string");
  });

  it("cacheKey is deterministic for the same input", async () => {
    const keys: string[] = [];
    const classifier = new MockIntentClassifier(
      [{ name: "brainstorm", activate_on: ["brainstorm"] }],
      {
        onClassification: (_result, _ms, key) => {
          keys.push(key);
        }
      }
    );
    await classifier.classify("brainstorm");
    await classifier.classify("brainstorm");
    expect(keys[0]).toBe(keys[1]);
  });
});
