import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const runTerminalCommandMock = vi.fn();

vi.mock("../../../lib/actions/code/runTerminalCommand", () => ({
  runTerminalCommand: (input: { projectId: string; command: string }) =>
    runTerminalCommandMock(input)
}));

import { TerminalPane } from "../../../components/code/TerminalPane";

beforeEach(() => {
  runTerminalCommandMock.mockReset();
});

function submit(value: string) {
  const input = screen.getByLabelText(/terminal command/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

describe("TerminalPane", () => {
  it("appends `$ {command}\\n{stdout}{stderr}` to scrollback after a successful run", async () => {
    runTerminalCommandMock.mockResolvedValue({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0
    });

    render(<TerminalPane projectId="p-1" />);
    submit("echo hello");

    await waitFor(() => {
      expect(runTerminalCommandMock).toHaveBeenCalledWith({
        projectId: "p-1",
        command: "echo hello"
      });
    });

    const scrollback = await screen.findByTestId("terminal-scrollback");
    await waitFor(() => {
      expect(scrollback.textContent).toBe("$ echo hello\nhello\n");
    });
  });

  it("renders a green badge on exit code 0", async () => {
    runTerminalCommandMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0
    });
    render(<TerminalPane projectId="p-1" />);
    submit("true");
    const badge = await screen.findByTestId("terminal-exit-badge");
    expect(badge.textContent).toBe("exit 0");
    expect(badge.className).toMatch(/emerald/);
    expect(badge.className).not.toMatch(/red/);
  });

  it("renders a red badge on non-zero exit code", async () => {
    runTerminalCommandMock.mockResolvedValue({
      stdout: "",
      stderr: "boom\n",
      exitCode: 2
    });
    render(<TerminalPane projectId="p-1" />);
    submit("false");
    const badge = await screen.findByTestId("terminal-exit-badge");
    expect(badge.textContent).toBe("exit 2");
    expect(badge.className).toMatch(/red/);
    expect(badge.className).not.toMatch(/emerald/);
  });

  it("appends multiple commands sequentially with a newline separator", async () => {
    runTerminalCommandMock
      .mockResolvedValueOnce({ stdout: "1\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "2\n", stderr: "", exitCode: 0 });

    render(<TerminalPane projectId="p-1" />);
    submit("echo 1");
    await waitFor(() =>
      expect(screen.getByTestId("terminal-scrollback").textContent).toBe(
        "$ echo 1\n1\n"
      )
    );

    submit("echo 2");
    await waitFor(() =>
      expect(screen.getByTestId("terminal-scrollback").textContent).toBe(
        "$ echo 1\n1\n\n$ echo 2\n2\n"
      )
    );
  });

  it("ignores empty submissions", async () => {
    render(<TerminalPane projectId="p-1" />);
    submit("   ");
    expect(runTerminalCommandMock).not.toHaveBeenCalled();
  });
});
