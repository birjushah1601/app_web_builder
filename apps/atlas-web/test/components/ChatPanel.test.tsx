import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "@/components/ChatPanel";

describe("ChatPanel", () => {
  it("submits user turn via injected server action", async () => {
    const action = vi.fn(async () => "r-1");
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
    const action = vi.fn(async () => "r-1");
    render(<ChatPanel projectId="p-1" action={action} />);
    const textarea = screen.getByPlaceholderText(/Describe your change/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "add login");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("adds the user turn to history immediately on send", async () => {
    const action = vi.fn(async () => "r-1");
    render(<ChatPanel projectId="p-1" action={action} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "hello world");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(await screen.findByText(/hello world/)).toBeInTheDocument();
  });

  it("disables the textarea while an action is in flight", async () => {
    let resolve!: (v: string) => void;
    const action = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    render(<ChatPanel projectId="p-1" action={action} />);
    const textarea = screen.getByPlaceholderText(/Describe your change/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "slow");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(textarea).toBeDisabled();
    resolve("r-1");
    await waitFor(() => expect(textarea).toBeEnabled());
  });

  it("ignores a second click while pending (no double-submit)", async () => {
    let resolve!: (v: string) => void;
    const action = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    render(<ChatPanel projectId="p-1" action={action} />);
    const textarea = screen.getByPlaceholderText(/Describe your change/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "once");
    const btn = screen.getByRole("button", { name: /Send/i });
    await userEvent.click(btn);
    await userEvent.click(btn); // while still pending — should no-op
    resolve("r-1");
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
      .mockResolvedValueOnce("r-1");
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
