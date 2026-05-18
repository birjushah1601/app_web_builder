import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel, type StartRitualResult } from "@/components/ChatPanel";

/**
 * Refine-by-default routing tests (Task A).
 *
 * The main ChatPanel input must:
 *   - Call `refineAction` (with parentRitualId) when initialLatestRitualId is
 *     present AND multiTurnFlagEnabled AND refineAction is provided.
 *   - Fall back to cold-start `action` otherwise.
 *   - Roll the parent forward across submits so a session that started cold
 *     refines on the just-produced ritual on the second submit.
 */

const okResult = (overrides?: Partial<StartRitualResult>): StartRitualResult => ({
  ritualId: "r-default",
  artifact: undefined,
  roleEvents: [],
  ...overrides
});

describe("ChatPanel — refine-by-default routing", () => {
  it("calls refineAction with parentRitualId when initialLatestRitualId is set + flag on", async () => {
    const action = vi.fn(async () => okResult({ ritualId: "r-cold" }));
    const refineAction = vi.fn(async () => ({
      ...okResult({ ritualId: "r-child" }),
      parentRitualId: "r-prior"
    }));
    render(
      <ChatPanel
        projectId="p-1"
        action={action}
        refineAction={refineAction}
        multiTurnFlagEnabled={true}
        initialLatestRitualId="r-prior"
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "tweak the header");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(refineAction).toHaveBeenCalledOnce();
    expect(refineAction).toHaveBeenCalledWith({
      projectId: "p-1",
      parentRitualId: "r-prior",
      userTurn: "tweak the header"
    });
    expect(action).not.toHaveBeenCalled();
  });

  it("falls back to cold-start `action` when initialLatestRitualId is absent", async () => {
    const action = vi.fn(async () => okResult({ ritualId: "r-cold" }));
    const refineAction = vi.fn();
    render(
      <ChatPanel
        projectId="p-1"
        action={action}
        refineAction={refineAction}
        multiTurnFlagEnabled={true}
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "first request");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith({
      projectId: "p-1",
      userTurn: "first request",
      editClass: "structural"
    });
    expect(refineAction).not.toHaveBeenCalled();
  });

  it("falls back to cold-start when multiTurnFlagEnabled is false, even with a known parent", async () => {
    const action = vi.fn(async () => okResult({ ritualId: "r-cold" }));
    const refineAction = vi.fn();
    render(
      <ChatPanel
        projectId="p-1"
        action={action}
        refineAction={refineAction}
        multiTurnFlagEnabled={false}
        initialLatestRitualId="r-prior"
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(action).toHaveBeenCalledOnce();
    expect(refineAction).not.toHaveBeenCalled();
  });

  it("falls back to cold-start when refineAction is not provided", async () => {
    const action = vi.fn(async () => okResult({ ritualId: "r-cold" }));
    render(
      <ChatPanel
        projectId="p-1"
        action={action}
        multiTurnFlagEnabled={true}
        initialLatestRitualId="r-prior"
      />
    );
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(action).toHaveBeenCalledOnce();
  });

  it("rolls latestRitualId forward — second submit refines on the first submit's child id", async () => {
    const action = vi.fn(async () => okResult({ ritualId: "r-first" }));
    const refineAction = vi.fn(async (input: { parentRitualId: string }) => ({
      ...okResult({ ritualId: `child-of-${input.parentRitualId}` }),
      parentRitualId: input.parentRitualId
    }));
    render(
      <ChatPanel
        projectId="p-1"
        action={action}
        refineAction={refineAction}
        multiTurnFlagEnabled={true}
      />
    );
    const ta = screen.getByPlaceholderText(/Describe your change/i);

    // First submit — no parent yet → cold-start. Result has ritualId=r-first.
    await userEvent.type(ta, "first");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());

    // Second submit — should now refine on r-first.
    await userEvent.type(ta, "second");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(refineAction).toHaveBeenCalledOnce());
    expect(refineAction).toHaveBeenCalledWith({
      projectId: "p-1",
      parentRitualId: "r-first",
      userTurn: "second"
    });
    // No additional cold-starts.
    expect(action).toHaveBeenCalledOnce();
  });

  it("rolls latestRitualId forward across refines — third submit refines on second turn's id", async () => {
    const action = vi.fn();
    const refineAction = vi.fn(async (input: { parentRitualId: string }) => ({
      ...okResult({ ritualId: `child-of-${input.parentRitualId}` }),
      parentRitualId: input.parentRitualId
    }));
    render(
      <ChatPanel
        projectId="p-1"
        action={action}
        refineAction={refineAction}
        multiTurnFlagEnabled={true}
        initialLatestRitualId="r-seed"
      />
    );
    const ta = screen.getByPlaceholderText(/Describe your change/i);

    // First submit refines on r-seed → child-of-r-seed.
    await userEvent.type(ta, "first");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() =>
      expect(refineAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ parentRitualId: "r-seed" })
      )
    );

    // Second submit refines on child-of-r-seed.
    await userEvent.type(ta, "second");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(refineAction).toHaveBeenCalledTimes(2));
    expect(refineAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentRitualId: "child-of-r-seed" })
    );

    // Cold-start path was never used.
    expect(action).not.toHaveBeenCalled();
  });
});
