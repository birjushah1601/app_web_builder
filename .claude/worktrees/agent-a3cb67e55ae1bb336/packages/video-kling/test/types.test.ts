import { describe, it, expect } from "vitest";
import {
  KlingGenerateInputSchema,
  KlingJobSchema,
  KlingCostCapSchema
} from "../src/types.js";

describe("KlingGenerateInputSchema", () => {
  it("accepts a minimal valid input (prompt only) + defaults", () => {
    const parsed = KlingGenerateInputSchema.parse({ prompt: "a cat" });
    expect(parsed.durationSec).toBe(5);
    expect(parsed.aspectRatio).toBe("16:9");
    expect(parsed.model).toBe("kling-v1-5");
  });

  it("rejects empty prompt", () => {
    expect(KlingGenerateInputSchema.safeParse({ prompt: "" }).success).toBe(false);
  });

  it("rejects duration > 10s (Kling cap)", () => {
    expect(
      KlingGenerateInputSchema.safeParse({ prompt: "x", durationSec: 11 }).success
    ).toBe(false);
  });

  it("rejects unknown aspect ratio", () => {
    expect(
      KlingGenerateInputSchema.safeParse({ prompt: "x", aspectRatio: "4:3" as never }).success
    ).toBe(false);
  });

  it("rejects unknown model", () => {
    expect(
      KlingGenerateInputSchema.safeParse({ prompt: "x", model: "kling-v99" as never }).success
    ).toBe(false);
  });

  it("accepts imageUrl + idempotencyKey", () => {
    const parsed = KlingGenerateInputSchema.parse({
      prompt: "x",
      imageUrl: "https://cdn.atlas.app/seed.png",
      idempotencyKey: "ritual-42"
    });
    expect(parsed.imageUrl).toBe("https://cdn.atlas.app/seed.png");
    expect(parsed.idempotencyKey).toBe("ritual-42");
  });
});

describe("KlingJobSchema", () => {
  it("accepts a minimal queued job", () => {
    expect(
      KlingJobSchema.safeParse({
        jobId: "kjob_1",
        status: "queued",
        submittedAtIso: "2026-04-22T00:00:00.000Z",
        updatedAtIso: "2026-04-22T00:00:00.000Z"
      }).success
    ).toBe(true);
  });

  it("accepts a succeeded job with video + usage", () => {
    expect(
      KlingJobSchema.safeParse({
        jobId: "kjob_1",
        status: "succeeded",
        videoUrl: "https://klingcdn.com/v/x.mp4",
        thumbnailUrl: "https://klingcdn.com/t/x.jpg",
        actualDurationSec: 5.1,
        usageUsd: 0.35,
        submittedAtIso: "2026-04-22T00:00:00.000Z",
        updatedAtIso: "2026-04-22T00:01:00.000Z"
      }).success
    ).toBe(true);
  });
});

describe("KlingCostCapSchema", () => {
  it("accepts a valid cap + default warnFraction", () => {
    const parsed = KlingCostCapSchema.parse({ capUsd: 50 });
    expect(parsed.warnFraction).toBe(0.8);
  });

  it("rejects warnFraction > 1", () => {
    expect(KlingCostCapSchema.safeParse({ capUsd: 50, warnFraction: 1.5 }).success).toBe(false);
  });
});
