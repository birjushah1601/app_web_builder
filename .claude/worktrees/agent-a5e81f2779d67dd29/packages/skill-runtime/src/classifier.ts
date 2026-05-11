/**
 * A single match result from intent classification.
 */
export interface ClassificationMatch {
  name: string;
  confidence: number; // 0–1; mock always uses 1.0 for exact token matches
}

/**
 * The result of classifying a user intent string.
 */
export interface ClassificationResult {
  intent: string;
  matches: ClassificationMatch[];
}

/**
 * Telemetry hook type — called after every classification.
 * `latencyMs` is the wall-clock time of the classification call.
 * `cacheKey` is a deterministic string derived from the intent; identical
 * intents produce identical keys so hit-rate tracking is accurate.
 */
export type OnClassificationHook = (
  result: ClassificationResult,
  latencyMs: number,
  cacheKey: string
) => void;

export interface ClassifierOptions {
  onClassification?: OnClassificationHook;
}

/**
 * Provider-agnostic intent-classifier interface.
 * C.1 ships the interface and a deterministic mock.
 * D.1 injects the real Haiku-4.5-backed implementation.
 */
export interface IntentClassifier {
  classify(intent: string): Promise<ClassificationResult>;
}

/** Minimal skill descriptor used by MockIntentClassifier (avoids circular dep on registry). */
export interface SkillDescriptor {
  name: string;
  activate_on: string[];
}

/**
 * Deterministic classifier for use in tests.
 * Matches when any token in `activate_on` appears (case-insensitive) in the intent string.
 * Fires the `onClassification` telemetry hook after every call.
 */
export class MockIntentClassifier implements IntentClassifier {
  private readonly skills: SkillDescriptor[];
  private readonly hook: OnClassificationHook | undefined;

  constructor(skills: SkillDescriptor[], options: ClassifierOptions = {}) {
    this.skills = skills;
    this.hook = options.onClassification;
  }

  async classify(intent: string): Promise<ClassificationResult> {
    const start = Date.now();
    const lower = intent.toLowerCase();

    const matches: ClassificationMatch[] = this.skills
      .filter((s) => s.activate_on.some((token) => lower.includes(token.toLowerCase())))
      .map((s) => ({ name: s.name, confidence: 1.0 }));

    const result: ClassificationResult = { intent, matches };
    const latencyMs = Date.now() - start;
    const cacheKey = `mock:${intent}`;

    this.hook?.(result, latencyMs, cacheKey);
    return result;
  }
}
