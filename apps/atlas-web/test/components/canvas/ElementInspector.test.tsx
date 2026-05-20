import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Module-level mocks for the Server Action imports. Without them, the
// component file pulls in `lib/sandbox/factory` (via applyElementAxisChange)
// which transitively requires @atlas/sandbox-e2b — an entry vitest can't
// resolve in this workspace. The component's prop seams (`proposeAxes`,
// `applyChange`) carry the test logic; these vi.mock stubs just keep the
// default-export references importable.
vi.mock("@/lib/actions/proposeElementAxes", () => ({
  proposeElementAxes: vi.fn().mockResolvedValue([])
}));
vi.mock("@/lib/actions/applyElementAxisChange", () => ({
  applyElementAxisChange: vi.fn().mockResolvedValue(undefined)
}));

import { ElementInspector } from "@/components/canvas/ElementInspector";
import type { ElementAxis } from "@/lib/actions/proposeElementAxes";
import type { DomNode } from "@/lib/canvas/use-element-selection";

/**
 * Plan UXO Task 8 — ElementInspector unit coverage.
 *
 * The component proposes axes via a Server Action and renders sliders.
 * Tests inject mock seams via `proposeAxes` / `applyChange` props so we
 * never touch a live LLM or sandbox. The Server Actions themselves are
 * exercised at runtime / via the e2e smoke spec.
 */

const SAMPLE_NODE: DomNode = {
  selector: "button:nth-child(1)",
  tag: "button",
  text: "Click me",
  rect: { x: 0, y: 0, width: 80, height: 32 },
  classes: ["btn", "btn-primary"]
};

const SAMPLE_AXES: ElementAxis[] = [
  {
    name: "border-radius",
    label: "Border radius",
    min: 0,
    max: 32,
    step: 1,
    unit: "px",
    currentValue: 4,
    cssProperty: "borderRadius"
  },
  {
    name: "primary-color",
    label: "Primary color",
    min: 0,
    max: 360,
    step: 1,
    unit: "deg",
    currentValue: 220,
    tokenKey: "palette.primary"
  }
];

describe("<ElementInspector>", () => {
  it("renders the empty-state hint when selected is null", () => {
    const proposeAxes = vi.fn();
    render(
      <ElementInspector
        projectId="p-1"
        selected={null}
        proposeAxes={proposeAxes}
        applyChange={vi.fn()}
      />
    );
    expect(screen.getByTestId("element-inspector-empty")).toHaveTextContent(
      /click an element/i
    );
    // Nothing should have been proposed for a null selection.
    expect(proposeAxes).not.toHaveBeenCalled();
  });

  it("calls proposeAxes with the selection context and renders a slider per axis", async () => {
    const proposeAxes = vi.fn().mockResolvedValue(SAMPLE_AXES);
    render(
      <ElementInspector
        projectId="p-1"
        selected={SAMPLE_NODE}
        proposeAxes={proposeAxes}
        applyChange={vi.fn()}
      />
    );

    // Verify the action was called with tag/classes/text — the shape the
    // server-side prompt expects.
    expect(proposeAxes).toHaveBeenCalledTimes(1);
    expect(proposeAxes).toHaveBeenCalledWith({
      tag: SAMPLE_NODE.tag,
      classes: SAMPLE_NODE.classes,
      text: SAMPLE_NODE.text
    });

    // Wait for the promise to resolve and React to flush the state update.
    await waitFor(() => {
      expect(screen.getAllByTestId("element-inspector-axis")).toHaveLength(2);
    });
    // One <input type="range"> per axis.
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(2);
    expect(sliders[0]!.getAttribute("min")).toBe("0");
    expect(sliders[0]!.getAttribute("max")).toBe("32");
    expect(sliders[0]!.getAttribute("step")).toBe("1");
  });

  it("fires applyChange when a slider value changes", async () => {
    const proposeAxes = vi.fn().mockResolvedValue([SAMPLE_AXES[1]!]); // tokenKey axis
    const applyChange = vi.fn().mockResolvedValue(undefined);
    render(
      <ElementInspector
        projectId="p-1"
        selected={SAMPLE_NODE}
        proposeAxes={proposeAxes}
        applyChange={applyChange}
      />
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("element-inspector-axis")).toHaveLength(1);
    });
    const slider = screen.getByRole("slider") as HTMLInputElement;
    // React listens for `change` on <input type="range">; fireEvent.change
    // is the canonical RTL helper here and it propagates the new value
    // through the synthetic event correctly.
    fireEvent.change(slider, { target: { value: "180" } });
    expect(applyChange).toHaveBeenCalledTimes(1);
    expect(applyChange).toHaveBeenCalledWith({
      projectId: "p-1",
      selector: SAMPLE_NODE.selector,
      axis: { tokenKey: "palette.primary" },
      value: "180deg"
    });
  });
});
