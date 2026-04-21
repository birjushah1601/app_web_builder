import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "@/components/ChatPanel.js";

describe("ChatPanel", () => {
  it("submits user turn via injected onSend", async () => {
    const onSend = vi.fn(async () => "r-1");
    render(<ChatPanel projectId="p-1" onSend={onSend} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "add login");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0][0]).toBe("add login");
  });
});
