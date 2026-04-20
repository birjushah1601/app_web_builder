import { randomUUID } from "node:crypto";

export class SharedTaskList<T extends { id: string }> {
  private items: T[] = [];
  private locks = new Map<string, string>(); // id → token

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!this.locks.has(item.id)) {
        this.items.splice(i, 1);
        return item;
      }
    }
    return undefined;
  }

  lock(id: string): string {
    if (this.locks.has(id)) throw new Error(`task ${id} already locked`);
    const token = randomUUID();
    this.locks.set(id, token);
    return token;
  }

  unlock(id: string, token: string): void {
    const current = this.locks.get(id);
    if (current === undefined) throw new Error(`task ${id} not locked`);
    if (current !== token) throw new Error(`unlock token mismatch for task ${id}`);
    this.locks.delete(id);
  }

  size(): number {
    return this.items.length;
  }
}
