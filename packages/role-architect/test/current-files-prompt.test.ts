import { describe, it, expect } from "vitest";
import { buildArchitectUserTurn } from "../src/deep-plan.js";

describe("buildArchitectUserTurn — currentFiles injection (Task B)", () => {
  it("when no currentFiles is set, the prompt has no '## Current sandbox files' section", () => {
    const out = buildArchitectUserTurn({
      userTurn: "build a thing",
      scope: "new-feature"
    });
    expect(out).not.toMatch(/## Current sandbox files/);
    expect(out).toContain("Scope: new-feature");
    expect(out).toContain("User intent: build a thing");
  });

  it("when currentFiles is empty, the prompt has no '## Current sandbox files' section", () => {
    const out = buildArchitectUserTurn({
      userTurn: "build a thing",
      scope: "new-feature",
      currentFiles: []
    });
    expect(out).not.toMatch(/## Current sandbox files/);
  });

  it("when currentFiles is non-empty, prepends a '## Current sandbox files' section enumerating paths + contents", () => {
    const out = buildArchitectUserTurn({
      userTurn: "add a banner",
      scope: "new-feature",
      currentFiles: [
        { path: "src/app/page.tsx", content: "export default function Page() { return <div>hi</div>; }" },
        { path: "src/app/layout.tsx", content: "export default function Layout({ children }) { return <html><body>{children}</body></html>; }" }
      ]
    });
    expect(out).toMatch(/## Current sandbox files/);
    expect(out).toContain("src/app/page.tsx");
    expect(out).toContain("src/app/layout.tsx");
    expect(out).toContain("export default function Page()");
    expect(out).toContain("export default function Layout(");
    // The "Scope: ... User intent: ..." block still lives at the end.
    expect(out).toContain("Scope: new-feature");
    expect(out).toContain("User intent: add a banner");
  });

  it("truncates files larger than 4KB with a head/tail elision marker", () => {
    const big = "X".repeat(10_000); // 10k chars — exceeds FILE_TRUNCATE_MAX (4k)
    const out = buildArchitectUserTurn({
      userTurn: "x",
      scope: "new-feature",
      currentFiles: [{ path: "src/big.ts", content: big }]
    });
    expect(out).toContain("src/big.ts");
    expect(out).toMatch(/\.\.\. \[\d+ chars elided\] \.\.\./);
    // Should NOT contain the full 10k X's verbatim.
    expect(out.length).toBeLessThan(10_000);
  });

  it("renders a placeholder when a file entry has no content", () => {
    const out = buildArchitectUserTurn({
      userTurn: "x",
      scope: "new-feature",
      currentFiles: [{ path: "src/binary.png" }]
    });
    expect(out).toContain("src/binary.png");
    expect(out).toMatch(/\(content not loaded\)/);
  });

  it("currentFiles AND priorRitual can both be present and render together", async () => {
    const { buildPriorRitualContext } = await import("@atlas/ritual-engine");
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      artifact: { kind: "plan", title: "earlier work" }
    });
    const out = buildArchitectUserTurn({
      userTurn: "iterate",
      scope: "new-feature",
      priorRitual: prior,
      currentFiles: [{ path: "src/app/page.tsx", content: "// existing page" }]
    });
    expect(out).toMatch(/## Current sandbox files/);
    expect(out).toMatch(/Previous turn/i);
    expect(out).toContain("src/app/page.tsx");
    expect(out).toContain("earlier work");
    // Sanity: section separator still appears.
    expect(out).toContain("---");
  });
});
