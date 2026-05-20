/** Generic registry mapping mode-id → renderer. The renderer type is left
 *  abstract so server-side code can register data adapters and client-side
 *  code can register React components against the same shape. */
export class CanvasModeRegistry<R> {
  private readonly entries = new Map<string, R>();

  register(id: string, renderer: R): void {
    if (this.entries.has(id)) {
      throw new Error(`canvas mode "${id}" already registered`);
    }
    this.entries.set(id, renderer);
  }

  lookup(id: string): R | undefined {
    return this.entries.get(id);
  }

  list(): string[] {
    return Array.from(this.entries.keys());
  }
}
