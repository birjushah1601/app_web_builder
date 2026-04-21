"use server";

import { auth } from "@clerk/nextjs/server";

export interface ConnectTerminalInput {
  projectId: string;
}

export interface ConnectTerminalResult {
  status: "stub";
  message: string;
}

/**
 * Stub: returns a "not connected" message.
 * Plan E.4 replaces this with a real WebSocket URL to the E2B sandbox terminal.
 */
export async function connectTerminal(
  input: ConnectTerminalInput
): Promise<ConnectTerminalResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  // TODO(E.4): provision or resume E2B sandbox for input.projectId,
  // then return a WebSocket URL for xterm.js to connect to.
  void input;
  return {
    status: "stub",
    message: "sandbox not connected yet (E.4)",
  };
}
