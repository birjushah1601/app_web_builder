export interface CheckpointRecord {
  ts: string;
  ritualId: string;
}

export interface CheckpointStore {
  hasPassed(projectId: string): Promise<boolean>;
  markPassed(projectId: string, record: CheckpointRecord): Promise<void>;
  getRecord(projectId: string): Promise<CheckpointRecord | null>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, CheckpointRecord>();
  async hasPassed(projectId: string): Promise<boolean> {
    return this.store.has(projectId);
  }
  async markPassed(projectId: string, record: CheckpointRecord): Promise<void> {
    this.store.set(projectId, record);
  }
  async getRecord(projectId: string): Promise<CheckpointRecord | null> {
    return this.store.get(projectId) ?? null;
  }
}
