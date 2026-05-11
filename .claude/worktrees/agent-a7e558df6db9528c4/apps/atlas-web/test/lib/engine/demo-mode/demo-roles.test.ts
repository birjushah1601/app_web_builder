import { describe, it, expect } from "vitest";
import { DemoArchitectRole } from "@/lib/engine/demo-mode/demo-architect-role";
import { DemoDeveloperRole } from "@/lib/engine/demo-mode/demo-developer-role";
import { CANNED_DEMO_DIFF, CANNED_DEMO_SUMMARY } from "@/lib/engine/demo-mode/canned-diff";

const inv = {
  ritualId: "r-test",
  intent: "doesn't matter — demo mode ignores it",
  graphSlice: { hash: "h", bytes: "{}" },
  userTurn: "build a thing"
};

describe("DemoArchitectRole — Plan Q Task 2", () => {
  it("emits architect.pass1.completed + architect.pass2.completed with a canned artifact", async () => {
    const role = new DemoArchitectRole();
    const out = await role.run(inv);
    const types = out.events.map((e) => e.eventType);
    expect(types).toEqual(["architect.pass1.completed", "architect.pass2.completed"]);
    const pass2 = out.events[1]!.payload as { artifact: { scope: string } };
    expect(pass2.artifact.scope).toBe("new-app");
  });

  it("returns diff: { kind: 'none' } — architect doesn't generate code", async () => {
    const out = await new DemoArchitectRole().run(inv);
    expect(out.diff.kind).toBe("none");
  });
});

describe("DemoDeveloperRole — Plan Q Task 3", () => {
  it("returns the canned diff body in patch shape so sandbox-apply runs unchanged", async () => {
    const role = new DemoDeveloperRole();
    const out = await role.run(inv);
    expect(out.diff.kind).toBe("patch");
    expect(out.diff.body).toBe(CANNED_DEMO_DIFF);
  });

  it("emits developer.completed with the canned summary", async () => {
    const out = await new DemoDeveloperRole().run(inv);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.eventType).toBe("developer.completed");
    const payload = out.events[0]!.payload as { summary: string };
    expect(payload.summary).toBe(CANNED_DEMO_SUMMARY);
  });

  it("the canned diff is a valid-looking unified diff (starts with 'diff --git', has @@)", () => {
    expect(CANNED_DEMO_DIFF.startsWith("diff --git")).toBe(true);
    expect(CANNED_DEMO_DIFF).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(CANNED_DEMO_DIFF).toContain("src/app/page.tsx");
  });
});
