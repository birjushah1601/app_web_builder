import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
