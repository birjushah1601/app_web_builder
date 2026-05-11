# @atlas/role-security

The Atlas **L4 Security gate** — a dual-interface package that implements both `Role` (from `@atlas/conductor`) and `GateRunner` (from `@atlas/gate-scheduler`).

## Dual-interface design

```
SecurityRole        implements Role        → Conductor.dispatch(roleId: "security")
SecurityGateRunner  implements GateRunner  → GateScheduler runs L4 sync or async per tier
```

Both interfaces share the same underlying `runSecurityCheck()` function. The `Role` wrapper emits events; the `GateRunner` wrapper maps `SecurityReport → GateResult`.

## Opus 4.7

Per PRD §11.3, the Security role uses **Opus 4.7** (`claude-opus-4-7`). Security rulings are high-stakes; accuracy takes priority over cost. The model is invoked via tool-use (`emit_security_report`) to enforce structured output.

## 4 composed skills

| Skill | What it checks |
|---|---|
| `audit-rls` | Every model exposes `rlsPolicies.select` + `rlsPolicies.insert` |
| `cors-policy` | No wildcard `allowedOrigins` on credentialed routes |
| `secrets-scan` | No hardcoded secrets, tokens, or credentials in the diff |
| `cve-check` | New/changed dependencies have no known critical CVEs |

Skills are loaded from `@atlas/skill-runtime` and assembled into the system prompt by `assembleSecurityPrompt()`.

## SecurityReport shape

```typescript
interface SecurityReport {
  passed: boolean;
  issues: SecurityIssue[];
  skillsRun: string[];
}

interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  code: string;      // e.g. "SEC-RLS-001", "SEC-CORS-003"
  message: string;
  file?: string;
  line?: number;
}
```

## `passed: false` criteria

`passed: false` is forced whenever **any issue has `severity: "critical"`**. High/medium/low issues are surfaced as warnings — the caller (Conductor or Scheduler) decides policy. This is enforced by a Zod `superRefine` on `SecurityReportSchema`.

## G.1 scheduler integration

`SecurityGateRunner` implements `GateRunner` with `layer: "L4"`. Register it with the G.1 `GateScheduler`:

```typescript
import { SecurityGateRunner } from "@atlas/role-security";

const runner = new SecurityGateRunner({ llm, skills });
scheduler.register(runner); // layer "L4" picked up automatically
```

## Event types emitted by SecurityRole

| Event | When |
|---|---|
| `security.started` | Role.run() begins |
| `security.passed` | No critical issues found |
| `security.failed` | At least one critical issue |
| `security.completed` | Always, carries full report |
| `security.errored` | LLM call throws (then re-throws) |
