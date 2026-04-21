export class SlidingWindow {
  private values: number[] = [];
  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error("capacity must be positive");
  }
  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }
  size(): number { return this.values.length; }
  reset(): void { this.values = []; }
  p50(): number { return this.percentile(0.50); }
  p95(): number { return this.percentile(0.95); }
  private percentile(p: number): number {
    if (this.values.length === 0) throw new Error("window empty");
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.floor(p * (sorted.length - 1));
    return sorted[idx];
  }
}
