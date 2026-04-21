"use server";

import { auth } from "@clerk/nextjs/server";

export interface VitestSuiteResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export interface GetTestResultsInput {
  projectId: string;
}

export interface GetTestResultsResult {
  status: "stub" | "running" | "done";
  suites: VitestSuiteResult[];
  message?: string;
}

/**
 * Stub: returns an empty test results payload.
 * Plan E.4 replaces this with real vitest JSON output streamed from the E2B sandbox.
 */
export async function getTestResults(
  input: GetTestResultsInput
): Promise<GetTestResultsResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  // TODO(E.4): stream vitest JSON results from the E2B sandbox for input.projectId.
  void input;
  return {
    status: "stub",
    suites: [],
    message: "test runner not connected yet (E.4)",
  };
}
