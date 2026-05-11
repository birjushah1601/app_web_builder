// apps/atlas-web/lib/projects/derive-name.test.ts
import { describe, it, expect } from "vitest";
import { deriveName } from "@/lib/projects/derive-name";

describe("deriveName", () => {
  it("strips a leading verb + article and kebab-cases the rest", () => {
    expect(deriveName("A landing page for my Mumbai spice kitchen"))
      .toBe("landing-page-mumbai-spice-kitchen");
  });

  it("handles 'build a' prefix", () => {
    expect(deriveName("Build a CRUD api for a todo app"))
      .toBe("crud-api-todo-app");
  });

  it("handles 'create a' prefix", () => {
    expect(deriveName("Create a dashboard that shows team metrics"))
      .toBe("dashboard-shows-team-metrics");
  });

  it("caps at 40 chars", () => {
    const long = "make me an absurdly long winded landing page about everything you can imagine";
    const out = deriveName(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).not.toMatch(/-$/);
  });

  it("falls back to untitled-* when prompt is all stopwords", () => {
    const out = deriveName("a the and or");
    expect(out).toMatch(/^untitled-[a-z0-9]{6}$/);
  });

  it("preserves words verbatim (no stemming)", () => {
    expect(deriveName("Tweakbits subscription page")).toBe("tweakbits-subscription-page");
  });

  it("lowercases", () => {
    expect(deriveName("Mumbai Spice Kitchen")).toBe("mumbai-spice-kitchen");
  });
});
