export interface CanvasOptionResolution {
  directionId: string;
  tokens: unknown;
  autoSelected: boolean;
}

interface RecommendedFallback {
  directionId: string;
  tokens: unknown;
}

interface WaitForOptionInput {
  ritualId: string;
  timeoutMs: number;
  recommendedFallback: RecommendedFallback;
}

interface PendingWaiter {
  resolve: (r: CanvasOptionResolution) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Engine-side promise registry. _runRitual awaits waitForOption; a Server
 *  Action's selectDesignDirection call invokes resolveOption on the same
 *  per-request engine instance. Timeout (default 30 min) auto-resolves with
 *  the architect/designer's recommended direction. */
export class CanvasPauseRegistry {
  private readonly waiters = new Map<string, PendingWaiter>();

  waitForOption(input: WaitForOptionInput): Promise<CanvasOptionResolution> {
    return new Promise<CanvasOptionResolution>((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiters.delete(input.ritualId)) {
          resolve({
            directionId: input.recommendedFallback.directionId,
            tokens: input.recommendedFallback.tokens,
            autoSelected: true
          });
        }
      }, input.timeoutMs);
      this.waiters.set(input.ritualId, { resolve, timer });
    });
  }

  /** Idempotent: second call for the same ritualId is a no-op so a stale
   *  Server-Action retry can't double-resolve. */
  resolveOption(ritualId: string, payload: { directionId: string; tokens: unknown }): void {
    const w = this.waiters.get(ritualId);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
    w.resolve({ directionId: payload.directionId, tokens: payload.tokens, autoSelected: false });
  }

  dispose(ritualId: string): void {
    const w = this.waiters.get(ritualId);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(ritualId);
  }

  pendingCount(): number {
    return this.waiters.size;
  }
}

/** Default 30-minute pause window per spec ("user never clicks → engine auto-selects"). */
export const DEFAULT_CANVAS_PAUSE_TIMEOUT_MS = 30 * 60 * 1000;
