import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// React 18.3.1 does NOT wire <form action={fn}> as a Server Action on the
// client — that's a React 19 feature. In Next.js production it works via
// the Next.js compiler; in vitest/jsdom we have neither React 19 nor Next's
// compiler, so the action prop is treated as a plain string attribute and
// never invoked. Workaround: mock the inner PromptForm to expose the
// passed-in `action` via a button the test can click, sidestepping the
// HTMLFormElement submit machinery (and jsdom's "Not implemented"
// requestSubmit) entirely. The wrapper-under-test's logic is unaffected;
// PromptForm itself has its own dedicated tests.

const { classifyMock, startWorkflowMock, startRitualMock, routerPush } = vi.hoisted(() => ({
  classifyMock: vi.fn(),
  startWorkflowMock: vi.fn(),
  startRitualMock: vi.fn(),
  routerPush: vi.fn()
}));

vi.mock("@/lib/actions/classifyAndCreateProject", () => ({ classifyAndCreateProject: classifyMock }));
vi.mock("@/lib/actions/startWorkflow", () => ({ startWorkflow: startWorkflowMock }));
vi.mock("@/lib/actions/startRitual", () => ({ startRitual: startRitualMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

// Mock PromptForm to expose the `action` prop via a test-only "submit"
// button that builds the FormData the wrapper expects (prompt textarea +
// hidden kind input). The real PromptForm is exercised by its own test
// file; here we just need a deterministic way to fire `action(formData)`.
vi.mock("@/app/projects/new/_components/PromptForm", () => ({
  PromptForm: ({
    action
  }: {
    action: (fd: FormData) => void | Promise<void>;
  }) => {
    const [prompt, setPrompt] = React.useState("");
    return (
      <div data-testid="mock-prompt-form">
        <textarea
          placeholder="What do you want to build? e.g. A landing page for my Mumbai spice kitchen with menu + online ordering"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            const fd = new FormData();
            fd.set("prompt", prompt);
            fd.set("kind", "auto");
            void action(fd);
          }}
        >
          Create
        </button>
      </div>
    );
  }
}));

import { PromptFormWithPicker } from "@/app/projects/new/_components/PromptFormWithPicker";

beforeEach(() => {
  classifyMock.mockReset();
  startWorkflowMock.mockReset();
  startRitualMock.mockReset();
  routerPush.mockReset();
});

describe("PromptFormWithPicker", () => {
  it("renders the inner PromptForm initially", () => {
    render(<PromptFormWithPicker />);
    expect(screen.getByPlaceholderText(/what do you want to build/i)).toBeInTheDocument();
  });

  it("on submit: classify -> ritual mode -> starts ritual + redirects to canvas (no picker shown)", async () => {
    classifyMock.mockResolvedValue({
      projectId: "proj-1",
      mode: "ritual",
      suggestedKinds: [],
      reasoning: "single-page"
    });
    startRitualMock.mockResolvedValue({ ritualId: "ritual-9", roleEvents: [] });

    render(<PromptFormWithPicker />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/what do you want to build/i),
      "Build a landing page"
    );
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(classifyMock).toHaveBeenCalled());
    await waitFor(() => expect(startRitualMock).toHaveBeenCalled());
    expect(screen.queryByTestId("workflow-picker-checklist")).toBeNull();
    expect(routerPush).toHaveBeenCalledWith("/projects/proj-1/canvas");
  });

  it("on submit: classify -> workflow mode -> renders WorkflowPickerChecklist", async () => {
    classifyMock.mockResolvedValue({
      projectId: "proj-1",
      mode: "workflow",
      suggestedKinds: ["backend-rest-api", "frontend-app"],
      reasoning: "API + UI"
    });

    render(<PromptFormWithPicker />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/what do you want to build/i),
      "API + dashboard"
    );
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-picker-checklist")).toBeInTheDocument();
    });
    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(startRitualMock).not.toHaveBeenCalled();
  });

  it("picker confirm -> startWorkflow + redirect to workflow page", async () => {
    classifyMock.mockResolvedValue({
      projectId: "proj-1",
      mode: "workflow",
      suggestedKinds: ["backend-rest-api", "frontend-app"],
      reasoning: "API + UI"
    });
    startWorkflowMock.mockResolvedValue({ workflowRunId: "wfr-1" });

    render(<PromptFormWithPicker />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/what do you want to build/i), "x");
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-picker-confirm")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("workflow-picker-confirm"));

    await waitFor(() => {
      expect(startWorkflowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          prompt: "x",
          suggestedKinds: ["backend-rest-api", "frontend-app"]
        })
      );
    });
    expect(routerPush).toHaveBeenCalledWith("/projects/proj-1/workflow/wfr-1");
  });

  it("picker downgrade -> startRitual + redirect to canvas", async () => {
    classifyMock.mockResolvedValue({
      projectId: "proj-1",
      mode: "workflow",
      suggestedKinds: ["backend-rest-api", "frontend-app"],
      reasoning: "API + UI"
    });
    startRitualMock.mockResolvedValue({ ritualId: "ritual-7", roleEvents: [] });

    render(<PromptFormWithPicker />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/what do you want to build/i), "x");
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-picker-downgrade")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("workflow-picker-downgrade"));

    await waitFor(() => {
      expect(startRitualMock).toHaveBeenCalled();
    });
    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/projects/proj-1/canvas");
  });

  it("surfaces classifier errors", async () => {
    classifyMock.mockRejectedValue(new Error("boom"));
    render(<PromptFormWithPicker />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/what do you want to build/i), "x");
    await user.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByTestId("prompt-form-with-picker-error")).toHaveTextContent("boom");
    });
  });

  it("renders an optional cost-cap input and threads it to startWorkflow", async () => {
    classifyMock.mockResolvedValue({
      projectId: "proj-1",
      mode: "workflow",
      suggestedKinds: ["backend-rest-api", "frontend-app"],
      reasoning: "API + UI"
    });
    startWorkflowMock.mockResolvedValue({ workflowRunId: "wfr-1" });

    render(<PromptFormWithPicker />);
    const user = userEvent.setup();
    const capInput = screen.getByTestId("prompt-form-cost-cap-input");
    await user.type(capInput, "7.50");

    await user.type(screen.getByPlaceholderText(/what do you want to build/i), "x");
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-picker-confirm")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("workflow-picker-confirm"));

    await waitFor(() => {
      expect(startWorkflowMock).toHaveBeenCalled();
    });
    const call = startWorkflowMock.mock.calls[0]![0];
    expect(call.costCapUsd).toBe(7.5);
  });

  it("omits costCapUsd when input is empty", async () => {
    classifyMock.mockResolvedValue({
      projectId: "proj-1",
      mode: "workflow",
      suggestedKinds: ["backend-rest-api"],
      reasoning: "x"
    });
    startWorkflowMock.mockResolvedValue({ workflowRunId: "wfr-1" });

    render(<PromptFormWithPicker />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/what do you want to build/i), "x");
    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-picker-confirm")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("workflow-picker-confirm"));

    await waitFor(() => {
      expect(startWorkflowMock).toHaveBeenCalled();
    });
    const call = startWorkflowMock.mock.calls[0]![0];
    expect(call.costCapUsd).toBeUndefined();
  });
});
