export class RitualEngineError extends Error {}

export class InvalidTransitionError extends RitualEngineError {
  readonly fromState: string;
  readonly transitionKind: string;
  constructor(fromState: string, transitionKind: string) {
    super(`invalid transition from state=${fromState} on kind=${transitionKind}`);
    this.name = "InvalidTransitionError";
    this.fromState = fromState;
    this.transitionKind = transitionKind;
  }
}
