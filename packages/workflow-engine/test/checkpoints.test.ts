import { describe, it, expect, vi } from "vitest";
import { CheckpointRecorder, type CheckpointWriter } from "../src/checkpoints";

describe("CheckpointRecorder", () => {
  describe("onEvent", () => {
    it("should not call writer for unregistered ritualId", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const recorder = new CheckpointRecorder(writer, new Map());

      const event = {
        type: "architect.pass1.completed",
        ritualId: "ritual-123",
        ts: "2025-01-01T00:00:00Z",
        payload: {}
      };

      await recorder.onEvent(event as any);

      expect(writer.append).not.toHaveBeenCalled();
    });

    it("should call writer for known checkpoint event kinds", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-123", { workflowRunId: "run-456", nodeId: "node-789" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      const event = {
        type: "architect.pass1.completed",
        ritualId: "ritual-123",
        ts: "2025-01-01T00:00:00Z",
        payload: { someKey: "someValue" }
      };

      await recorder.onEvent(event as any);

      expect(writer.append).toHaveBeenCalledOnce();
      expect(writer.append).toHaveBeenCalledWith({
        workflowRunId: "run-456",
        nodeId: "node-789",
        kind: "architect.pass1.completed",
        payload: { someKey: "someValue" }
      });
    });

    it("should not call writer for unknown event kinds", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-123", { workflowRunId: "run-456", nodeId: "node-789" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      const events = [
        {
          type: "unknown.event.kind",
          ritualId: "ritual-123",
          ts: "2025-01-01T00:00:00Z",
          payload: {}
        },
        {
          type: "another.unknown",
          ritualId: "ritual-123",
          ts: "2025-01-01T00:00:01Z",
          payload: {}
        }
      ];

      for (const event of events) {
        await recorder.onEvent(event as any);
      }

      expect(writer.append).not.toHaveBeenCalled();
    });

    it("should batch developer.candidate.delta events every 50", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-123", { workflowRunId: "run-456", nodeId: "node-789" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      // Send 50 delta events
      for (let i = 0; i < 50; i++) {
        const event = {
          type: "developer.candidate.delta",
          ritualId: "ritual-123",
          ts: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
          payload: { delta: i }
        };
        await recorder.onEvent(event as any);
      }

      // Should have called writer once (at the 50th event)
      expect(writer.append).toHaveBeenCalledOnce();
      expect(writer.append).toHaveBeenCalledWith({
        workflowRunId: "run-456",
        nodeId: "node-789",
        kind: "developer_candidate_delta_batch",
        payload: { batchedDeltaCount: 50 }
      });
    });

    it("should batch developer.candidate.delta at 100 events (two batches)", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-123", { workflowRunId: "run-456", nodeId: "node-789" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      // Send 100 delta events
      for (let i = 0; i < 100; i++) {
        const event = {
          type: "developer.candidate.delta",
          ritualId: "ritual-123",
          ts: `2025-01-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`,
          payload: { delta: i }
        };
        await recorder.onEvent(event as any);
      }

      // Should have called writer twice (at 50th and 100th events)
      expect(writer.append).toHaveBeenCalledTimes(2);
      expect(writer.append).toHaveBeenNthCalledWith(1, {
        workflowRunId: "run-456",
        nodeId: "node-789",
        kind: "developer_candidate_delta_batch",
        payload: { batchedDeltaCount: 50 }
      });
      expect(writer.append).toHaveBeenNthCalledWith(2, {
        workflowRunId: "run-456",
        nodeId: "node-789",
        kind: "developer_candidate_delta_batch",
        payload: { batchedDeltaCount: 100 }
      });
    });

    it("should count developer.candidate.delta independently per ritual", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-1", { workflowRunId: "run-1", nodeId: "node-1" }],
        ["ritual-2", { workflowRunId: "run-2", nodeId: "node-2" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      // Send 50 deltas for ritual-1
      for (let i = 0; i < 50; i++) {
        const event = {
          type: "developer.candidate.delta",
          ritualId: "ritual-1",
          ts: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
          payload: { delta: i }
        };
        await recorder.onEvent(event as any);
      }

      // Send 50 deltas for ritual-2 (should trigger a batch for ritual-2 at 50)
      for (let i = 0; i < 50; i++) {
        const event = {
          type: "developer.candidate.delta",
          ritualId: "ritual-2",
          ts: `2025-01-01T00:01:${String(i).padStart(2, "0")}Z`,
          payload: { delta: i }
        };
        await recorder.onEvent(event as any);
      }

      // Should have called writer twice (once per ritual at 50 deltas each)
      expect(writer.append).toHaveBeenCalledTimes(2);
      expect(writer.append).toHaveBeenNthCalledWith(1, {
        workflowRunId: "run-1",
        nodeId: "node-1",
        kind: "developer_candidate_delta_batch",
        payload: { batchedDeltaCount: 50 }
      });
      expect(writer.append).toHaveBeenNthCalledWith(2, {
        workflowRunId: "run-2",
        nodeId: "node-2",
        kind: "developer_candidate_delta_batch",
        payload: { batchedDeltaCount: 50 }
      });
    });

    it("should pass ritualEventId when present in event", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-123", { workflowRunId: "run-456", nodeId: "node-789" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      const event = {
        type: "researcher.brief.completed",
        ritualId: "ritual-123",
        ts: "2025-01-01T00:00:00Z",
        payload: {},
        ritualEventId: "event-999"
      };

      await recorder.onEvent(event as any);

      expect(writer.append).toHaveBeenCalledWith({
        workflowRunId: "run-456",
        nodeId: "node-789",
        kind: "researcher.brief.completed",
        payload: {},
        ritualEventId: "event-999"
      });
    });
  });

  describe("registerRitualForNode", () => {
    it("should register a ritual and allow subsequent events to be recorded", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const recorder = new CheckpointRecorder(writer, new Map());

      // Initially, unregistered
      await recorder.onEvent({
        type: "designer.draft.completed",
        ritualId: "ritual-123",
        ts: "2025-01-01T00:00:00Z",
        payload: {}
      } as any);

      expect(writer.append).not.toHaveBeenCalled();

      // Register the ritual
      recorder.registerRitualForNode("ritual-123", "run-456", "node-789");

      // Now it should be recorded
      await recorder.onEvent({
        type: "designer.draft.completed",
        ritualId: "ritual-123",
        ts: "2025-01-01T00:00:00Z",
        payload: {}
      } as any);

      expect(writer.append).toHaveBeenCalledOnce();
      expect(writer.append).toHaveBeenCalledWith({
        workflowRunId: "run-456",
        nodeId: "node-789",
        kind: "designer.draft.completed",
        payload: {}
      });
    });
  });

  describe("all checkpoint event types", () => {
    it("should checkpoint all known event kinds from CHECKPOINT_EVENT_TYPES", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-123", { workflowRunId: "run-456", nodeId: "node-789" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      const eventKinds = [
        "architect.pass1.completed",
        "architect.pass2.completed",
        "researcher.brief.completed",
        "designer.draft.completed",
        "designer.critique.completed",
        "designer.revise.completed",
        "designer.proposal.completed",
        "canvas.option.selected",
        "ritual.triage.clarification_resolved",
        "sandbox.apply.completed",
        "asset.gen.completed"
      ];

      for (const kind of eventKinds) {
        await recorder.onEvent({
          type: kind,
          ritualId: "ritual-123",
          ts: "2025-01-01T00:00:00Z",
          payload: {}
        } as any);
      }

      expect(writer.append).toHaveBeenCalledTimes(eventKinds.length);

      for (let i = 0; i < eventKinds.length; i++) {
        expect(writer.append).toHaveBeenNthCalledWith(i + 1, {
          workflowRunId: "run-456",
          nodeId: "node-789",
          kind: eventKinds[i],
          payload: {}
        });
      }
    });
  });

  describe("payload handling", () => {
    it("should use empty object if payload is undefined", async () => {
      const writer: CheckpointWriter = {
        append: vi.fn()
      };
      const ritualToNode = new Map([
        ["ritual-123", { workflowRunId: "run-456", nodeId: "node-789" }]
      ]);
      const recorder = new CheckpointRecorder(writer, ritualToNode);

      const event = {
        type: "designer.draft.completed",
        ritualId: "ritual-123",
        ts: "2025-01-01T00:00:00Z"
        // no payload field
      };

      await recorder.onEvent(event as any);

      expect(writer.append).toHaveBeenCalledWith({
        workflowRunId: "run-456",
        nodeId: "node-789",
        kind: "designer.draft.completed",
        payload: {}
      });
    });
  });
});
