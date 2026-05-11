import { describe, it, expect } from "vitest";
import { SlidingWindow } from "../src/window.js";

describe("SlidingWindow", () => {
  it("p50 + p95 of [100..1000] (100 samples) approximate 500 + 950 ms", () => {
    const w = new SlidingWindow(1000);
    for (let i = 1; i <= 100; i++) w.push(i * 10);
    expect(w.p50()).toBeGreaterThan(495);
    expect(w.p50()).toBeLessThan(515);
    expect(w.p95()).toBeGreaterThan(940);
    expect(w.p95()).toBeLessThan(960);
  });

  it("evicts oldest when window full", () => {
    const w = new SlidingWindow(3);
    w.push(100); w.push(200); w.push(300); w.push(400);
    expect(w.size()).toBe(3);
    expect(w.p50()).toBe(300); // [200, 300, 400]
  });

  it("size + reset behaviors", () => {
    const w = new SlidingWindow(10);
    w.push(1); w.push(2); w.push(3);
    expect(w.size()).toBe(3);
    w.reset();
    expect(w.size()).toBe(0);
  });

  it("p50/p95 throw on empty window", () => {
    const w = new SlidingWindow(10);
    expect(() => w.p50()).toThrow();
    expect(() => w.p95()).toThrow();
  });
});
