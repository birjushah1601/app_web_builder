import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import { WorkflowPickerChecklist } from "@/components/workflow/WorkflowPickerChecklist";

describe("WorkflowPickerChecklist", () => {
  it("renders a checkbox per suggested kind, all pre-ticked", () => {
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["frontend-app", "backend-rest-api", "tests"]}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByTestId("picker-check-frontend-app")).toBeChecked();
    expect(screen.getByTestId("picker-check-backend-rest-api")).toBeChecked();
    expect(screen.getByTestId("picker-check-tests")).toBeChecked();
  });

  it("renders the classifier reasoning when provided", () => {
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["frontend-app"]}
        reasoning="Multi-artifact build because the prompt mentions API + UI"
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByTestId("workflow-picker-reasoning")).toHaveTextContent(
      /multi-artifact build/i
    );
  });

  it("toggling a checkbox excludes it from the confirm payload", () => {
    const onConfirm = vi.fn();
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["frontend-app", "tests"]}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByTestId("picker-check-tests"));
    fireEvent.click(screen.getByTestId("workflow-picker-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(["frontend-app"]);
  });

  it("preserves the suggestedKinds order in the confirm payload", () => {
    const onConfirm = vi.fn();
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["backend-rest-api", "frontend-app", "tests"]}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByTestId("workflow-picker-confirm"));
    expect(onConfirm).toHaveBeenCalledWith([
      "backend-rest-api",
      "frontend-app",
      "tests"
    ]);
  });

  it("disables confirm + shows hint when every kind is unticked", () => {
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["frontend-app"]}
        onConfirm={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("picker-check-frontend-app"));
    expect(screen.getByTestId("workflow-picker-confirm")).toBeDisabled();
    expect(screen.getByTestId("workflow-picker-empty-hint")).toBeInTheDocument();
  });

  it("does not render the downgrade button when onDowngrade is omitted", () => {
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["frontend-app"]}
        onConfirm={vi.fn()}
      />
    );
    expect(screen.queryByTestId("workflow-picker-downgrade")).toBeNull();
  });

  it("invokes onDowngrade when the user opts out", () => {
    const onDowngrade = vi.fn();
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["frontend-app"]}
        onConfirm={vi.fn()}
        onDowngrade={onDowngrade}
      />
    );
    fireEvent.click(screen.getByTestId("workflow-picker-downgrade"));
    expect(onDowngrade).toHaveBeenCalled();
  });

  it("disables every interactive control while pending", () => {
    render(
      <WorkflowPickerChecklist
        suggestedKinds={["frontend-app"]}
        onConfirm={vi.fn()}
        onDowngrade={vi.fn()}
        pending
      />
    );
    expect(screen.getByTestId("picker-check-frontend-app")).toBeDisabled();
    expect(screen.getByTestId("workflow-picker-confirm")).toBeDisabled();
    expect(screen.getByTestId("workflow-picker-downgrade")).toBeDisabled();
  });
});
