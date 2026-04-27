import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel, type StartRitualResult } from "@/components/ChatPanel";

/** Action factory: returns the new StartRitualResult shape with sane defaults. */
const okResult = (overrides?: Partial<StartRitualResult>): StartRitualResult => ({
  ritualId: "r-1",
  artifact: undefined,
  roleEvents: [],
  ...overrides
});

describe("ChatPanel", () => {
  it("submits user turn via injected server action", async () => {
    const action = vi.fn(async () => okResult());
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "add login");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith({
      projectId: "p-1",
      userTurn: "add login",
      editClass: "structural"
    });
  });

  it("clears the textarea only on success", async () => {
    const action = vi.fn(async () => okResult());
    render(<ChatPanel projectId="p-1" action={action} />);
    const textarea = screen.getByPlaceholderText(/Describe your change/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "add login");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("adds the user turn to history immediately on send", async () => {
    const action = vi.fn(async () => okResult());
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "hello world");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(await screen.findByText(/hello world/)).toBeInTheDocument();
  });

  it("disables the textarea while an action is in flight", async () => {
    let resolve!: (v: StartRitualResult) => void;
    const action = vi.fn(() => new Promise<StartRitualResult>((r) => { resolve = r; }));
    render(<ChatPanel projectId="p-1" action={action} />);
    const textarea = screen.getByPlaceholderText(/Describe your change/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "slow");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(textarea).toBeDisabled();
    resolve(okResult());
    await waitFor(() => expect(textarea).toBeEnabled());
  });

  it("ignores a second click while pending (no double-submit)", async () => {
    let resolve!: (v: StartRitualResult) => void;
    const action = vi.fn(() => new Promise<StartRitualResult>((r) => { resolve = r; }));
    render(<ChatPanel projectId="p-1" action={action} />);
    const textarea = screen.getByPlaceholderText(/Describe your change/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "once");
    const btn = screen.getByRole("button", { name: /Send/i });
    await userEvent.click(btn);
    await userEvent.click(btn); // while still pending — should no-op
    resolve(okResult());
    await waitFor(() => expect(textarea).toBeEnabled());
    expect(action).toHaveBeenCalledOnce();
  });

  it("Send button is disabled for empty / whitespace-only input", async () => {
    const action = vi.fn();
    render(<ChatPanel projectId="p-1" action={action} />);
    const btn = screen.getByRole("button", { name: /Send/i });
    expect(btn).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "   ");
    expect(btn).toBeDisabled();
  });

  it("renders an error alert when the action rejects, and the UI stays responsive", async () => {
    const action = vi.fn(async () => {
      throw new Error("provider is asleep");
    });
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "trigger error");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/provider is asleep/);

    // Pending should have cleared, so the Send button is usable again.
    expect(screen.getByRole("button", { name: /Send/i })).toBeEnabled();
  });

  it("shows a generic error message when the action throws a non-Error value", async () => {
    const action = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "kaboom";
    });
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/kaboom/);
  });

  it("clears the error when a subsequent send succeeds", async () => {
    const action = vi.fn()
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce(okResult());
    render(<ChatPanel projectId="p-1" action={action} />);

    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "attempt one");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/first failed/);

    // Type a new message and send; the alert should go away.
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "attempt two");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("ChatPanel — architect output rendering", () => {
  it("renders the 'needs input' panel when triage emitted blocking questions", async () => {
    const action = vi.fn(async () => okResult({
      roleEvents: [
        { eventType: "architect.pass1.completed", payload: { passed: false, scope: "feature" } },
        { eventType: "architect.triage.needs_input", payload: { question: "Which framework?", reason: "Affects scope" } },
        { eventType: "architect.triage.needs_input", payload: { question: "Mobile or web?", reason: "Affects layout" } }
      ]
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "build a thing");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const panel = await screen.findByTestId("architect-needs-input");
    expect(panel).toHaveTextContent(/Architect needs more info/);
    expect(panel).toHaveTextContent(/Which framework\?/);
    expect(panel).toHaveTextContent(/Affects scope/);
    expect(panel).toHaveTextContent(/Mobile or web\?/);
    expect(screen.queryByTestId("architect-plan")).not.toBeInTheDocument();
  });

  it("renders the architect plan with structured steps when artifact has plan.steps", async () => {
    const action = vi.fn(async () => okResult({
      artifact: {
        scope: "new-feature",
        summary: "Add a login flow",
        plan: {
          steps: [
            { title: "Auth UI", description: "build the login form" },
            { title: "Endpoint", description: "POST /api/login" },
            { title: "Tests" }
          ]
        }
      },
      roleEvents: []
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "add login");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const panel = await screen.findByTestId("architect-plan");
    expect(panel).toHaveTextContent(/Architect plan \(new-feature\)/);
    expect(panel).toHaveTextContent(/Add a login flow/);
    expect(panel).toHaveTextContent(/Auth UI/);
    expect(panel).toHaveTextContent(/build the login form/);
    expect(panel).toHaveTextContent(/Endpoint/);
    expect(panel).toHaveTextContent(/Tests/); // step with no description still renders title
  });

  it("falls back to a JSON dump when artifact has no structured plan.steps", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "bug-fix", rootCause: "race condition", remediation: "lock pool" },
      roleEvents: []
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "fix the race");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const panel = await screen.findByTestId("architect-plan");
    expect(panel).toHaveTextContent(/Architect plan \(bug-fix\)/);
    expect(panel).toHaveTextContent(/Raw plan/);
    // The summary <details> contains the raw artifact JSON
    expect(panel).toHaveTextContent(/race condition/);
    expect(panel).toHaveTextContent(/lock pool/);
  });

  it("shows the no-output diagnostic when neither artifact nor needs_input present", async () => {
    const action = vi.fn(async () => okResult({
      roleEvents: [{ eventType: "architect.pass1.started", payload: { ritualId: "r-1" } }]
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const panel = await screen.findByTestId("architect-no-output");
    expect(panel).toHaveTextContent(/Architect ran but produced no plan or questions/);
  });

  it("renders the developer output card with diff + summary when developerOutput is present", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "feature", summary: "Add login", plan: { steps: [{ title: "auth UI" }] } },
      developerOutput: {
        diff: "diff --git a/src/login.tsx b/src/login.tsx\n--- a/src/login.tsx\n+++ b/src/login.tsx\n@@ -0,0 +1,3 @@\n+export function Login() {\n+  return <form />;\n+}\n",
        summary: "Added a Login component"
      },
      roleEvents: [
        { eventType: "developer.completed", payload: { summary: "Added a Login component" } }
      ]
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "add login");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const dev = await screen.findByTestId("developer-output");
    expect(dev).toHaveTextContent(/Developer wrote code/);
    expect(dev).toHaveTextContent(/Added a Login component/);
    expect(dev).toHaveTextContent(/1 file changed/);
    expect(dev).toHaveTextContent(/View diff/);
    // Architect plan still rendered above
    expect(screen.getByTestId("architect-plan")).toBeInTheDocument();
  });

  it("renders the developer-failed card when chain hit developer.dispatch.failed", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "feature", summary: "do x", plan: { steps: [{ title: "step" }] } },
      roleEvents: [
        { eventType: "developer.dispatch.failed", payload: { error: "unknown role: developer" } }
      ]
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    const fail = await screen.findByTestId("developer-failed");
    expect(fail).toHaveTextContent(/Developer step failed/);
    expect(fail).toHaveTextContent(/unknown role: developer/);
    // Architect plan still shows
    expect(screen.getByTestId("architect-plan")).toBeInTheDocument();
  });

  it("does NOT render developer card when chain didn't reach developer (e.g. cosmetic edit, or no artifact)", async () => {
    const action = vi.fn(async () => okResult({
      artifact: { scope: "feature", summary: "x", plan: { steps: [{ title: "step" }] } },
      roleEvents: []
    }));
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    await screen.findByTestId("architect-plan");
    expect(screen.queryByTestId("developer-output")).not.toBeInTheDocument();
    expect(screen.queryByTestId("developer-failed")).not.toBeInTheDocument();
  });

  it("multiple sends accumulate independent architect outputs in history", async () => {
    const action = vi.fn()
      .mockResolvedValueOnce(okResult({
        artifact: { scope: "feature", summary: "first plan", plan: { steps: [{ title: "step-A" }] } },
        roleEvents: []
      }))
      .mockResolvedValueOnce(okResult({
        roleEvents: [
          { eventType: "architect.triage.needs_input", payload: { question: "second time, more info?", reason: "" } }
        ]
      }));
    render(<ChatPanel projectId="p-1" action={action} />);

    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "first");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await screen.findByText(/first plan/);

    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "second");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await screen.findByText(/second time, more info\?/);

    // Both panels should still be in history
    expect(screen.getByText(/first plan/)).toBeInTheDocument();
    expect(screen.getByText(/second time, more info\?/)).toBeInTheDocument();
  });
});
