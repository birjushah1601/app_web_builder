import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvalFailedCard } from "@/components/ritual/EvalFailedCard";

describe("EvalFailedCard", () => {
  it("renders structural failures", () => {
    render(
      <EvalFailedCard
        roleId="architect"
        layer="structural"
        attempts={2}
        verdicts={[{
          layer: "structural",
          passed: false,
          failures: [{ check: "plan_has_tasks", reason: "tasks empty" }]
        }]}
      />
    );
    expect(screen.getByTestId("eval-failed-card")).toBeInTheDocument();
    expect(screen.getByText(/plan_has_tasks/)).toBeInTheDocument();
    expect(screen.getByText(/tasks empty/)).toBeInTheDocument();
  });

  it("renders failed judge dimensions only (score < 6)", () => {
    render(
      <EvalFailedCard
        roleId="architect"
        layer="judge"
        attempts={2}
        verdicts={[{
          layer: "judge",
          passed: false,
          dimensions: [
            { name: "intent_coverage", score: 3, rationale: "missed billing" },
            { name: "feasibility", score: 8, rationale: "ok" }
          ]
        }]}
      />
    );
    expect(screen.getByText(/intent_coverage/)).toBeInTheDocument();
    expect(screen.getByText(/missed billing/)).toBeInTheDocument();
    expect(screen.queryByText(/feasibility/)).not.toBeInTheDocument();
  });

  it("capitalizes the roleId in the heading", () => {
    render(
      <EvalFailedCard
        roleId="developer"
        layer="structural"
        attempts={2}
        verdicts={[{ layer: "structural", passed: false }]}
      />
    );
    expect(screen.getByText(/Developer output failed quality check/)).toBeInTheDocument();
  });

  it("renders Retry button and calls onRetryWithEdits with prefill markdown", async () => {
    const onRetryWithEdits = vi.fn();
    render(
      <EvalFailedCard
        roleId="architect"
        layer="structural"
        attempts={2}
        verdicts={[{
          layer: "structural",
          passed: false,
          failures: [{ check: "plan_has_tasks", reason: "tasks empty" }]
        }]}
        onRetryWithEdits={onRetryWithEdits}
      />
    );
    const btn = screen.getByRole("button", { name: /Retry with my edits/i });
    await userEvent.click(btn);
    expect(onRetryWithEdits).toHaveBeenCalledOnce();
    const prefill: string = onRetryWithEdits.mock.calls[0][0];
    expect(prefill).toContain("plan_has_tasks");
    expect(prefill).toContain("tasks empty");
    expect(prefill).toContain("## What went wrong");
  });

  it("renders restart button and calls onRestart", async () => {
    const onRestart = vi.fn();
    render(
      <EvalFailedCard
        roleId="architect"
        layer="structural"
        attempts={2}
        verdicts={[{ layer: "structural", passed: false }]}
        onRestart={onRestart}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Edit prompt/i }));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("omits buttons when handlers are not provided", () => {
    render(
      <EvalFailedCard
        roleId="architect"
        layer="structural"
        attempts={2}
        verdicts={[{ layer: "structural", passed: false }]}
      />
    );
    expect(screen.queryByRole("button", { name: /Retry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit prompt/i })).not.toBeInTheDocument();
  });

  it("shows the fixed-copy sentence about retry attempts", () => {
    render(
      <EvalFailedCard
        roleId="architect"
        layer="structural"
        attempts={2}
        verdicts={[{ layer: "structural", passed: false }]}
      />
    );
    expect(screen.getByText(/Retry attempted once with feedback/)).toBeInTheDocument();
  });
});
