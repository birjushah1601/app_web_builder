# @atlas/role-accessibility

The Atlas **L5 Accessibility gate** — a dual-interface package that implements both `Role` (from `@atlas/conductor`) and `GateRunner` (from `@atlas/gate-scheduler`).

## Dual-interface design

```
AccessibilityRole        implements Role        → Conductor.dispatch(roleId: "accessibility")
AccessibilityGateRunner  implements GateRunner  → GateScheduler runs L5 sync or async per tier
```

Both interfaces share the same underlying `runAccessibilityCheck()` function. The `Role` wrapper emits events; the `GateRunner` wrapper maps `AccessibilityReport → GateResult`.

## Sonnet 4.6

Per PRD §11.3, the Accessibility role uses **Sonnet 4.6** (`claude-sonnet-4-6`). A11y findings are structured checklist items (WCAG rule lookups + pattern checks) — the failure modes are well-understood, and cost sensitivity is higher because a11y checks run per page/per component. The model is invoked via tool-use (`emit_accessibility_report`) to enforce structured output.

## 4 composed skills

| Skill | What it checks |
|---|---|
| `wcag-audit` | Images have alt text, forms have labels, headings are sequential (WCAG 2.2 AA) |
| `rtl-layout` | `dir="rtl"` set for RTL languages; logical CSS properties used; bidi isolation |
| `keyboard-nav` | All interactive elements focusable; ARIA keyboard patterns; no keyboard traps |
| `contrast-check` | Text contrast ≥ 4.5:1 (normal) and ≥ 3:1 (large text) per WCAG 1.4.3 AA |

Skills are loaded from `@atlas/skill-runtime` and assembled into the system prompt by `assembleAccessibilityPrompt()`.

## AccessibilityReport shape

```typescript
interface AccessibilityReport {
  passed: boolean;
  issues: AccessibilityIssue[];
  skillsRun: string[];
}

interface AccessibilityIssue {
  severity: "critical" | "high" | "medium" | "low";
  code: string;      // e.g. "A11Y-WCAG-004", "A11Y-RTL-001", "A11Y-KB-007", "A11Y-CON-002"
  message: string;
  file?: string;
  line?: number;
}
```

## `passed: false` criteria

`passed: false` is forced whenever **any issue has `severity: "critical"`**. The severity mapping:

| Severity | Meaning |
|---|---|
| `critical` | WCAG 2.2 **AA-failing** issue — L5 gate blocks on this |
| `high` | WCAG 2.2 AAA-failing issue |
| `medium` | Minor visual or usability issue |
| `low` | Nice-to-have improvement |

High/medium/low issues are surfaced as warnings — the caller (Conductor or Scheduler) decides policy. Enforced by a Zod `superRefine` on `AccessibilityReportSchema`.

## G.1 scheduler integration

`AccessibilityGateRunner` implements `GateRunner` with `layer: "L5"`. Register it with the G.1 `GateScheduler`:

```typescript
import { AccessibilityGateRunner } from "@atlas/role-accessibility";

const runner = new AccessibilityGateRunner({ llm, skills });
scheduler.register(runner); // layer "L5" picked up automatically
```

## Event types emitted by AccessibilityRole

| Event | When |
|---|---|
| `accessibility.started` | Role.run() begins |
| `accessibility.passed` | No critical issues found |
| `accessibility.failed` | At least one critical issue |
| `accessibility.completed` | Always, carries full report |
| `accessibility.errored` | LLM call throws (then re-throws) |

## axe-core integration (deferred to follow-up)

v1 ships LLM-driven skill composition. A future `D.5-axe-integration` micro-plan wires real `axe-core` runs in the E2B sandbox and folds results into `AccessibilityReport.issues`. The `AccessibilityReport` shape already supports the axe-core data model (`file`, `line`, `message`, `code`).
