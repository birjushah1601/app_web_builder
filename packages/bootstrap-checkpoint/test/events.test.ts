import { describe, it, expect } from "vitest";
import { BootstrapEventSchema, type BootstrapEvent } from "../src/events.js";

describe("BootstrapEventSchema", () => {
  it("parses bootstrap.required", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.required", ritualId: "r-1", projectId: "p-1", ts: "t"
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });

  it("parses bootstrap.passed", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.passed", ritualId: "r-1", projectId: "p-1", ts: "t",
      payload: { itemKeys: ["compliance_class", "auth_provider"] }
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });

  it("parses bootstrap.failed with itemResults", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.failed", ritualId: "r-1", projectId: "p-1", ts: "t",
      payload: { failedKeys: ["compliance_class"], notes: { compliance_class: "actually GDPR not HIPAA" } }
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });

  it("parses bootstrap.escalation_requested with free-text and reviewer", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.escalation_requested", ritualId: "r-1", projectId: "p-1", ts: "t",
      payload: { freeText: "I just have a bad feeling about the auth setup", requestedReviewer: "priya" }
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });
});
