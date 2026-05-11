import { z } from "zod";
import { GateLayerSchema } from "./types.js";

export const AsyncGateJobSchema = z.object({
  id: z.string(),
  layer: GateLayerSchema,
  ritualId: z.string(),
  projectId: z.string(),
  commitSha: z.string(),
  graphSliceHash: z.string(),
  enqueuedAt: z.string()
});
export type AsyncGateJob = z.infer<typeof AsyncGateJobSchema>;

export interface AsyncGateQueue {
  enqueue(job: AsyncGateJob): Promise<void>;
  dequeue(): Promise<AsyncGateJob | null>;
  size(): Promise<number>;
}

export class InMemoryAsyncQueue implements AsyncGateQueue {
  private items: AsyncGateJob[] = [];
  async enqueue(job: AsyncGateJob): Promise<void> {
    this.items.push(job);
  }
  async dequeue(): Promise<AsyncGateJob | null> {
    return this.items.shift() ?? null;
  }
  async size(): Promise<number> {
    return this.items.length;
  }
}
