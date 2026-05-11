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

export class PersonaGateError extends RitualEngineError {
  readonly gate: string;
  readonly actualPersona: string;
  readonly requiredPersona: string;
  constructor(gate: string, actualPersona: string, requiredPersona: string) {
    super(`persona ${actualPersona} cannot risk-accept gate ${gate}; requires ${requiredPersona} or higher`);
    this.name = "PersonaGateError";
    this.gate = gate;
    this.actualPersona = actualPersona;
    this.requiredPersona = requiredPersona;
  }
}

export class RitualAbortedError extends RitualEngineError {
  readonly ritualId: string;
  readonly reason: string;
  constructor(ritualId: string, reason: string) {
    super(`ritual ${ritualId} aborted: ${reason}`);
    this.name = "RitualAbortedError";
    this.ritualId = ritualId;
    this.reason = reason;
  }
}
