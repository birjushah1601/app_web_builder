# @atlas/ritual-engine

The headless state machine that drives Atlas's **Visualize → Agree → Build** ritual. UI surfaces (Plan E.2 Atlas Web; future external integrations) consume this engine.

## Architecture

`RitualEngine` is purely deterministic over its inputs. It takes three injected dependencies:

- `Conductor` from `@atlas/conductor` — dispatches role invocations.
- `EventSink` — emits typed `RitualEvent`s. Production wires through `@atlas/spec-graph-data.spec_events`; tests use `InMemoryEventSink`.
- `PersonaPreferences` — resolves a user/project pair to a `PersonaTier` (ama/diego/priya).

## State machine

```
visualize → agree (artifact_emitted) → build (approved) → done (merge_gates_green)
visualize → build (artifact_emitted_cosmetic — fast path)
agree → visualize (changes_requested)
* → escalated (escalate)
* → aborted (abort)
```

Terminal states: `done`, `escalated`, `aborted`.

## Public API

```ts
import {
  RitualEngine,
  type StartInput, type ApprovalDecision, type RiskAccepted,
  PersonaGateError, InvalidTransitionError
} from "@atlas/ritual-engine";

const engine = new RitualEngine({ conductor, eventSink, personaPreferences });
const ritualId = await engine.start({ userTurn, editClass, projectId, userId });
await engine.approve(ritualId, { kind: "approved", approvedBy, persona });
await engine.markBuildComplete(ritualId);
```

## Risk-accept persona gate (PRD §9.5)

Per the open-question resolution OQ5, the engine enforces:

| Gate | Min persona |
|---|---|
| L4-security | diego |
| L5-compliance | diego |
| L6-a11y-advisory | ama |
| L7-visual-advisory | ama |

Calling `engine.acceptRisk(ritualId, event)` with an under-privileged persona throws `PersonaGateError` and emits no `ritual.risk_accepted` event. UI surfaces should render an "ask a reviewer" affordance in response.

## Edit-class fast path (PRD §9.5)

`StartInput.editClass` controls the state-machine shape:
- `cosmetic` → 2-state (`visualize → build`); the Agree step is skipped.
- `structural` → full 3-state (`visualize → agree → build`).
- `security-compliance-touching` → full 3-state with explicit human-confirmation gate (Plan F.1's bootstrap-checkpoint pre-pends).

The classifier itself is Plan G.1; this engine just respects the hint.

## Testing

```bash
cd packages/ritual-engine
pnpm test
```
