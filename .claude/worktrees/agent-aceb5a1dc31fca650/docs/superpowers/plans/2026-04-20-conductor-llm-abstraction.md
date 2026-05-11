# Conductor + LLM Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/llm-provider/` and `packages/conductor/` — the thin Conductor orchestrator from PRD §11.3 and a multi-provider LLM abstraction that wraps `@anthropic-ai/sdk` (with a Google stub deferred to D.3). Conductor classifies intent via a C.1-injected `IntentClassifier`, assembles a 3-tier prompt-cache prefix, composes role invocations, checkpoints after every emitted event, and retries transient failures with exponential backoff. LLM provider ships with library-level retry + circuit breaker + OpenTelemetry spans + Prometheus metrics.

**Architecture:** Two separate pnpm-workspace packages so the LLM surface stays reusable outside the conductor (the future HTTP validate endpoint, the test harness, and any CLI tool that calls Claude will import from `@atlas/llm-provider`). Conductor depends on `@atlas/llm-provider`, `@atlas/spec-graph-data`, `@atlas/spec-graph-schema`, and `@atlas/skill-runtime` (all workspace). Role packages (D.2–D.5) depend on `@atlas/conductor`. Roles themselves are **out of scope** for D.1 — they're mocked via a `Role` interface and a `TestRole` stub. No real LLM API calls in tests; the Anthropic SDK is mocked throughout.

**Tech Stack:** TypeScript 5.6.3 · pnpm workspaces · Zod 3.23.8 · `@anthropic-ai/sdk` 0.32+ · `@opentelemetry/api` 1.9 · `@opentelemetry/sdk-trace-node` 1.28 · `prom-client` 15.x · Vitest 2.1.8 · Node 22 LTS. All pins match the versions already in `packages/spec-graph-data/package.json` (verify at execution time).

**Prerequisites the implementing engineer needs installed before starting:**
- Plans A.1, B.1, and B.2 merged. `@atlas/spec-graph-data` and `@atlas/spec-graph-schema` are in the workspace.
- Plan C.1 authored (may or may not be merged — D.1 consumes C.1's `IntentClassifier` interface shape from its design, not from runtime).
- Node 22 LTS (`node --version` ≥ v22) and pnpm 9+.
- DB required only for Task 20 (integration test); reuses A.1's docker-compose Postgres on port 5433.
- An Anthropic API key is **not** required — all provider tests mock the SDK.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  llm-provider/                            # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts                             # public API: LLMProvider, errors, AnthropicProvider, GoogleProvider
      provider.ts                          # LLMProvider interface + LLMMessage/LLMCompletion/LLMStreamChunk/LLMCallOptions types
      errors.ts                            # ProviderError hierarchy (transient flag)
      retry.ts                             # exponential-backoff retry wrapper
      circuit-breaker.ts                   # 5-fail open, 30s half-open
      observability.ts                     # shared otel tracer + prometheus counters/histograms
      anthropic.ts                         # AnthropicProvider wrapping @anthropic-ai/sdk with prompt-cache awareness
      google.ts                            # stub GoogleProvider (throws on call — D.3 replaces)
    test/
      errors.test.ts
      retry.test.ts
      circuit-breaker.test.ts
      anthropic.test.ts                    # SDK mocked; asserts message assembly + cache_control blocks
      anthropic-stream.test.ts             # streaming path with SDK mocked
      observability.test.ts                # span + metrics emission assertions

  conductor/                               # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts                             # public API
      conductor.ts                         # Conductor class + dispatch()
      dispatch-context.ts                  # DispatchContext + RetryPolicy + RitualId Zod types
      errors.ts                            # RitualEscalatedError and friends
      graph-slice.ts                       # deterministic serializeSlice() + hashSlice()
      prompt-cache.ts                      # buildPromptCacheBlocks(rolePrompt, graphSlice, userTurn)
      shared-task-list.ts                  # typed queue + per-task lock primitive
      messaging.ts                         # topic-based pub/sub with at-least-once delivery
      file-lock.ts                         # lockfile primitive (reentrant for same holder)
      role.ts                              # Role interface + TestRole stub
      retry-policy.ts                      # canonical retry policies (default, none, strict)
    test/
      graph-slice.test.ts
      prompt-cache.test.ts
      shared-task-list.test.ts
      messaging.test.ts
      file-lock.test.ts
      dispatch-happy.test.ts
      dispatch-retry-success.test.ts
      dispatch-retry-exhausted.test.ts
      dispatch-retry-policy.test.ts
      integration.test.ts                  # full dispatch with mocked provider + in-memory registries

docs/superpowers/plans/
  README.md                                # MODIFIED — add D.1 entry to plan index
```

**Why this shape.** Two packages so the LLM surface is reusable. Each `src/*.ts` file has one responsibility; test files mirror source files for easy navigation. `graph-slice.ts` + `prompt-cache.ts` are distinct because the slice serialization is generically useful (future HTTP-validate endpoint will reuse it) while the cache-block shape is Anthropic-specific.

---

## Open-question resolutions

These resolutions close four of the Unit D directional-doc open questions. OQ1 (internal lib) and OQ5 (Browser-Verification deferred to Phase B-8) were already locked in B.2's T17 refresh.

- **OQ2 (prompt-cache prefix shape) → 3-tier deterministic assembly.** Layer (a) = role system prompt (stable across turns; one Anthropic message with `cache_control: { type: "ephemeral" }`). Layer (b) = graph-context slice (slow-changing, keyed by graph version + content hash). Layer (c) = user turn (fast-changing, no cache). Slice (b) serialization is deterministic: sort nodes lexicographically by `id`, sort edges by the composite `(from, to, type)`, canonicalise via `JSON.stringify` with a `replacer` that preserves sort order, SHA-256 the resulting bytes. The hash becomes the cache-key suffix so a slice change produces a cold cache entry.

- **OQ3 (role recovery on failure) → checkpoint-after-emit + exponential retry.** Conductor writes a `checkpoint.emitted` event to `@atlas/spec-graph-data`'s `spec_events` stream after each role-emitted event. On role failure, retry up to 3 times with backoff (100ms → 400ms → 1600ms). On the third failure, emit a `ritual.escalated` event and halt the ritual per PRD §9.5. Retry policy is conductor-injected per `dispatch()` call, NOT hard-coded in the role — matches B.1's opt-in validator pattern (data layer stays schema-agnostic; policy is injected by the caller).

- **OQ4 (parallel Developer runs) → deferred to D.3.** D.1 ships the single-provider single-role path. Parallelism + Reviewer voting belongs with the Developer-role plan (D.3).

- **OQ6 (retry / circuit-breaker location) → library-level default with per-role override.** `LLMProvider` wraps every call with the default retry policy + circuit breaker. Roles pass `{ retry: "none" }` through `LLMCallOptions` to opt out for that call. Default policy: exponential backoff (100ms → 400ms → 1600ms, max 3 attempts, transient errors only) + circuit breaker (opens after 5 consecutive failures per `{provider, model}`, half-opens after 30 seconds, closes on first success).

---

## Tasks

### Task 1: Scaffold `packages/llm-provider/`

**Files:**
- Create: `packages/llm-provider/package.json`
- Create: `packages/llm-provider/tsconfig.json`
- Create: `packages/llm-provider/vitest.config.ts`
- Create: `packages/llm-provider/src/index.ts` (placeholder)

No TDD — scaffolding. Verification: `pnpm -F @atlas/llm-provider typecheck` exits 0.

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p packages/llm-provider/src packages/llm-provider/test
```

- [ ] **Step 2: Write package.json**

`packages/llm-provider/package.json`:

```json
{
  "name": "@atlas/llm-provider",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@opentelemetry/api": "^1.9.0",
    "prom-client": "^15.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

`packages/llm-provider/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules"]
}
```

- [ ] **Step 4: Write vitest.config.ts**

`packages/llm-provider/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node"
  }
});
```

- [ ] **Step 5: Write placeholder src/index.ts**

`packages/llm-provider/src/index.ts`:

```typescript
// Public API is populated by subsequent tasks.
export {};
```

- [ ] **Step 6: Install + verify**

```bash
pnpm install
pnpm -F @atlas/llm-provider typecheck
pnpm -F @atlas/llm-provider build
```

Expected: `typecheck` and `build` both exit 0. `dist/index.js` is created (even if empty).

- [ ] **Step 7: Commit**

```bash
git add packages/llm-provider/ pnpm-lock.yaml
git commit -m "feat(llm-provider): scaffold package with pnpm, tsconfig, vitest"
```

---

### Task 2: `LLMProvider` interface + message/call types

**Files:**
- Create: `packages/llm-provider/src/provider.ts`
- Create: `packages/llm-provider/test/provider.types.test.ts`

- [ ] **Step 1: Write the failing type test**

`packages/llm-provider/test/provider.types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { LLMProvider, LLMMessage, LLMCompletion, LLMStreamChunk, LLMCallOptions } from "../src/provider.js";

describe("LLMProvider types", () => {
  it("LLMMessage accepts user + assistant + system + cache_control", () => {
    const sys: LLMMessage = { role: "system", content: "you are helpful", cache_control: { type: "ephemeral" } };
    const usr: LLMMessage = { role: "user", content: "hello" };
    const asst: LLMMessage = { role: "assistant", content: "hi" };
    expectTypeOf(sys).toMatchTypeOf<LLMMessage>();
    expectTypeOf(usr).toMatchTypeOf<LLMMessage>();
    expectTypeOf(asst).toMatchTypeOf<LLMMessage>();
  });

  it("LLMCallOptions has model, maxTokens, retry override", () => {
    const opts: LLMCallOptions = {
      model: "claude-sonnet-4-6",
      maxTokens: 1024,
      retry: "default"
    };
    expectTypeOf(opts.retry).toEqualTypeOf<"default" | "none" | "strict" | undefined>();
  });

  it("LLMProvider.complete returns Promise<LLMCompletion>", () => {
    type CompleteFn = LLMProvider["complete"];
    expectTypeOf<CompleteFn>().returns.toMatchTypeOf<Promise<LLMCompletion>>();
  });

  it("LLMProvider.stream returns AsyncIterable<LLMStreamChunk>", () => {
    type StreamFn = LLMProvider["stream"];
    expectTypeOf<StreamFn>().returns.toMatchTypeOf<AsyncIterable<LLMStreamChunk>>();
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm -F @atlas/llm-provider test provider.types
```

Expected: fails with `Cannot find module '../src/provider.js'`.

- [ ] **Step 3: Implement**

`packages/llm-provider/src/provider.ts`:

```typescript
import { z } from "zod";

export const CacheControlSchema = z.object({
  type: z.literal("ephemeral")
});
export type CacheControl = z.infer<typeof CacheControlSchema>;

export const LLMMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  cache_control: CacheControlSchema.optional()
});
export type LLMMessage = z.infer<typeof LLMMessageSchema>;

export const LLMCallOptionsSchema = z.object({
  model: z.string(),
  maxTokens: z.number().int().positive().max(200000),
  temperature: z.number().min(0).max(2).optional(),
  stopSequences: z.array(z.string()).optional(),
  retry: z.enum(["default", "none", "strict"]).optional()
});
export type LLMCallOptions = z.infer<typeof LLMCallOptionsSchema>;

export const LLMUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  cacheReadInputTokens: z.number().int().nonnegative().optional()
});
export type LLMUsage = z.infer<typeof LLMUsageSchema>;

export const LLMCompletionSchema = z.object({
  content: z.string(),
  model: z.string(),
  stopReason: z.enum(["end_turn", "max_tokens", "stop_sequence", "tool_use"]),
  usage: LLMUsageSchema
});
export type LLMCompletion = z.infer<typeof LLMCompletionSchema>;

export type LLMStreamChunk =
  | { type: "content_delta"; delta: string }
  | { type: "usage"; usage: LLMUsage }
  | { type: "message_stop"; stopReason: LLMCompletion["stopReason"] };

export interface LLMProvider {
  readonly name: string; // "anthropic" | "google"
  complete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion>;
  stream(messages: LLMMessage[], options: LLMCallOptions): AsyncIterable<LLMStreamChunk>;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm -F @atlas/llm-provider test provider.types
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-provider/src/provider.ts packages/llm-provider/test/provider.types.test.ts
git commit -m "feat(llm-provider): define LLMProvider interface + message/call Zod types"
```

---

### Task 3: `ProviderError` hierarchy with transient flag

**Files:**
- Create: `packages/llm-provider/src/errors.ts`
- Create: `packages/llm-provider/test/errors.test.ts`

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ProviderError, NetworkError, RateLimitError, InvalidRequestError, isTransient } from "../src/errors.js";

describe("ProviderError hierarchy", () => {
  it("ProviderError is the base class", () => {
    const e = new ProviderError("boom", { transient: false });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ProviderError");
    expect(e.transient).toBe(false);
  });

  it("NetworkError is transient by default", () => {
    const e = new NetworkError("connection reset");
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.transient).toBe(true);
    expect(e.name).toBe("NetworkError");
  });

  it("RateLimitError is transient with retryAfter hint", () => {
    const e = new RateLimitError("too many", { retryAfterMs: 5000 });
    expect(e.transient).toBe(true);
    expect(e.retryAfterMs).toBe(5000);
  });

  it("InvalidRequestError is permanent", () => {
    const e = new InvalidRequestError("missing model");
    expect(e.transient).toBe(false);
  });

  it("isTransient distinguishes correctly", () => {
    expect(isTransient(new NetworkError("x"))).toBe(true);
    expect(isTransient(new RateLimitError("x"))).toBe(true);
    expect(isTransient(new InvalidRequestError("x"))).toBe(false);
    expect(isTransient(new Error("untyped"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/llm-provider test errors
```

Expected: fails (module not found).

- [ ] **Step 3: Implement**

`packages/llm-provider/src/errors.ts`:

```typescript
export interface ProviderErrorOptions {
  transient: boolean;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly transient: boolean;
  readonly cause?: unknown;
  constructor(message: string, options: ProviderErrorOptions) {
    super(message);
    this.name = "ProviderError";
    this.transient = options.transient;
    this.cause = options.cause;
  }
}

export class NetworkError extends ProviderError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { transient: true, cause: options.cause });
    this.name = "NetworkError";
  }
}

export class RateLimitError extends ProviderError {
  readonly retryAfterMs: number | undefined;
  constructor(message: string, options: { retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, { transient: true, cause: options.cause });
    this.name = "RateLimitError";
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class InvalidRequestError extends ProviderError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { transient: false, cause: options.cause });
    this.name = "InvalidRequestError";
  }
}

export function isTransient(err: unknown): boolean {
  return err instanceof ProviderError && err.transient === true;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/llm-provider test errors
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-provider/src/errors.ts packages/llm-provider/test/errors.test.ts
git commit -m "feat(llm-provider): add ProviderError hierarchy with transient-error classification"
```

---

### Task 4: Exponential-backoff retry wrapper

**Files:**
- Create: `packages/llm-provider/src/retry.ts`
- Create: `packages/llm-provider/test/retry.test.ts`

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { retry, DEFAULT_RETRY_POLICY, NO_RETRY_POLICY } from "../src/retry.js";
import { NetworkError, InvalidRequestError } from "../src/errors.js";

describe("retry wrapper", () => {
  it("returns on first success", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await retry(fn, DEFAULT_RETRY_POLICY);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error up to max attempts", async () => {
    let count = 0;
    const fn = vi.fn(async () => {
      count++;
      if (count < 3) throw new NetworkError("transient");
      return "ok";
    });
    const result = await retry(fn, DEFAULT_RETRY_POLICY, { sleep: async () => {} });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn(async () => { throw new NetworkError("always"); });
    await expect(retry(fn, DEFAULT_RETRY_POLICY, { sleep: async () => {} }))
      .rejects.toThrow(NetworkError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on permanent errors", async () => {
    const fn = vi.fn(async () => { throw new InvalidRequestError("bad"); });
    await expect(retry(fn, DEFAULT_RETRY_POLICY, { sleep: async () => {} }))
      .rejects.toThrow(InvalidRequestError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("NO_RETRY_POLICY calls fn exactly once even on transient errors", async () => {
    const fn = vi.fn(async () => { throw new NetworkError("transient"); });
    await expect(retry(fn, NO_RETRY_POLICY)).rejects.toThrow(NetworkError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backoff doubles between attempts", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    let count = 0;
    const fn = async () => {
      count++;
      if (count < 3) throw new NetworkError("transient");
      return "ok";
    };
    await retry(fn, DEFAULT_RETRY_POLICY, { sleep });
    expect(delays).toEqual([100, 400]); // 100, 400 (next would be 1600 but third attempt succeeds)
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/llm-provider test retry
```

- [ ] **Step 3: Implement**

`packages/llm-provider/src/retry.ts`:

```typescript
import { isTransient, RateLimitError } from "./errors.js";

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly multiplier: number;
  readonly name: "default" | "none" | "strict";
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  multiplier: 4, // 100, 400, 1600
  name: "default"
};

export const NO_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  baseDelayMs: 0,
  multiplier: 1,
  name: "none"
};

export const STRICT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 200,
  multiplier: 3,
  name: "strict"
};

export interface RetryHooks {
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  hooks: RetryHooks = {}
): Promise<T> {
  const sleep = hooks.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err)) throw err;
      if (attempt === policy.maxAttempts - 1) break;
      const hinted = err instanceof RateLimitError && err.retryAfterMs !== undefined
        ? err.retryAfterMs
        : policy.baseDelayMs * Math.pow(policy.multiplier, attempt);
      await sleep(hinted);
    }
  }
  throw lastError;
}

export function resolvePolicy(name: "default" | "none" | "strict" | undefined): RetryPolicy {
  switch (name) {
    case "none": return NO_RETRY_POLICY;
    case "strict": return STRICT_RETRY_POLICY;
    default: return DEFAULT_RETRY_POLICY;
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/llm-provider test retry
```

Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-provider/src/retry.ts packages/llm-provider/test/retry.test.ts
git commit -m "feat(llm-provider): exponential-backoff retry wrapper with default/none/strict policies"
```

---

### Task 5: Circuit breaker (5-failure open, 30s half-open)

**Files:**
- Create: `packages/llm-provider/src/circuit-breaker.ts`
- Create: `packages/llm-provider/test/circuit-breaker.test.ts`

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/circuit-breaker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../src/circuit-breaker.js";
import { NetworkError } from "../src/errors.js";

describe("CircuitBreaker", () => {
  it("starts closed and allows calls through", async () => {
    const cb = new CircuitBreaker({ key: "anthropic:sonnet-4-6", openAfter: 5, halfOpenAfterMs: 30_000 });
    const result = await cb.run(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.state).toBe("closed");
  });

  it("opens after 5 consecutive failures", async () => {
    const cb = new CircuitBreaker({ key: "k", openAfter: 5, halfOpenAfterMs: 30_000 });
    for (let i = 0; i < 5; i++) {
      await expect(cb.run(async () => { throw new NetworkError("boom"); })).rejects.toThrow(NetworkError);
    }
    expect(cb.state).toBe("open");
    await expect(cb.run(async () => "should-not-run")).rejects.toThrow(CircuitOpenError);
  });

  it("half-opens after halfOpenAfterMs", async () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker({ key: "k", openAfter: 2, halfOpenAfterMs: 30_000, clock });
    await expect(cb.run(async () => { throw new NetworkError("f1"); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new NetworkError("f2"); })).rejects.toThrow();
    expect(cb.state).toBe("open");
    now += 31_000;
    expect(cb.state).toBe("half-open");
  });

  it("closes on first success after half-open", async () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker({ key: "k", openAfter: 2, halfOpenAfterMs: 30_000, clock });
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    now += 31_000;
    const result = await cb.run(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.state).toBe("closed");
  });

  it("reopens immediately on half-open failure", async () => {
    let now = 1000;
    const clock = { now: () => now };
    const cb = new CircuitBreaker({ key: "k", openAfter: 2, halfOpenAfterMs: 30_000, clock });
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    await expect(cb.run(async () => { throw new NetworkError("x"); })).rejects.toThrow();
    now += 31_000;
    await expect(cb.run(async () => { throw new NetworkError("still"); })).rejects.toThrow();
    expect(cb.state).toBe("open");
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/llm-provider test circuit-breaker
```

- [ ] **Step 3: Implement**

`packages/llm-provider/src/circuit-breaker.ts`:

```typescript
import { isTransient } from "./errors.js";

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`circuit breaker open for ${key}`);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  key: string;
  openAfter: number;
  halfOpenAfterMs: number;
  clock?: { now(): number };
}

type State = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly clock: { now(): number };
  private readonly opts: CircuitBreakerOptions;

  constructor(opts: CircuitBreakerOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? { now: () => Date.now() };
  }

  get state(): State {
    if (this.openedAt === null) return "closed";
    if (this.clock.now() - this.openedAt >= this.opts.halfOpenAfterMs) return "half-open";
    return "open";
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.state;
    if (s === "open") throw new CircuitOpenError(this.opts.key);
    try {
      const result = await fn();
      if (s === "half-open" || this.failures > 0) {
        this.failures = 0;
        this.openedAt = null;
      }
      return result;
    } catch (err) {
      if (s === "half-open") {
        this.openedAt = this.clock.now();
      } else if (isTransient(err)) {
        this.failures += 1;
        if (this.failures >= this.opts.openAfter) {
          this.openedAt = this.clock.now();
        }
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/llm-provider test circuit-breaker
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**
```bash
git add packages/llm-provider/src/circuit-breaker.ts packages/llm-provider/test/circuit-breaker.test.ts
git commit -m "feat(llm-provider): circuit breaker — opens after 5 failures, half-opens after 30s"
```

---

### Task 6: Observability primitives (OTel tracer + Prometheus metrics)

**Files:**
- Create: `packages/llm-provider/src/observability.ts`
- Create: `packages/llm-provider/test/observability.test.ts`

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/observability.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Registry } from "prom-client";
import { createProviderMetrics, instrumentCall } from "../src/observability.js";
import { NetworkError } from "../src/errors.js";

describe("observability", () => {
  it("createProviderMetrics registers counter + histogram", () => {
    const registry = new Registry();
    const metrics = createProviderMetrics(registry);
    expect(metrics.requestsTotal).toBeDefined();
    expect(metrics.latencySeconds).toBeDefined();
  });

  it("instrumentCall increments success counter on resolve", async () => {
    const registry = new Registry();
    const metrics = createProviderMetrics(registry);
    const result = await instrumentCall(
      { provider: "anthropic", model: "sonnet-4-6", metrics },
      async () => "ok"
    );
    expect(result).toBe("ok");
    const raw = await registry.getMetricsAsJSON();
    const reqMetric = raw.find((m) => m.name === "atlas_llm_provider_requests_total");
    expect(reqMetric).toBeDefined();
    const val = (reqMetric as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values
      .find((v) => v.labels.status === "success");
    expect(val?.value).toBe(1);
  });

  it("instrumentCall labels error status", async () => {
    const registry = new Registry();
    const metrics = createProviderMetrics(registry);
    await expect(instrumentCall(
      { provider: "anthropic", model: "sonnet-4-6", metrics },
      async () => { throw new NetworkError("x"); }
    )).rejects.toThrow();
    const raw = await registry.getMetricsAsJSON();
    const reqMetric = raw.find((m) => m.name === "atlas_llm_provider_requests_total");
    const val = (reqMetric as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values
      .find((v) => v.labels.status === "error");
    expect(val?.value).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/llm-provider test observability
```

- [ ] **Step 3: Implement**

`packages/llm-provider/src/observability.ts`:

```typescript
import { Counter, Histogram, Registry } from "prom-client";
import { trace, SpanStatusCode, type Tracer } from "@opentelemetry/api";

export interface ProviderMetrics {
  requestsTotal: Counter<string>;
  latencySeconds: Histogram<string>;
}

export function createProviderMetrics(registry: Registry): ProviderMetrics {
  const requestsTotal = new Counter({
    name: "atlas_llm_provider_requests_total",
    help: "Total LLM provider requests",
    labelNames: ["provider", "model", "status"],
    registers: [registry]
  });
  const latencySeconds = new Histogram({
    name: "atlas_llm_provider_latency_seconds",
    help: "LLM provider request latency",
    labelNames: ["provider", "model", "status"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry]
  });
  return { requestsTotal, latencySeconds };
}

export interface InstrumentContext {
  provider: string;
  model: string;
  metrics: ProviderMetrics;
  tracer?: Tracer;
}

export async function instrumentCall<T>(ctx: InstrumentContext, fn: () => Promise<T>): Promise<T> {
  const tracer = ctx.tracer ?? trace.getTracer("@atlas/llm-provider");
  const start = Date.now();
  return tracer.startActiveSpan(`llm.${ctx.provider}.call`, async (span) => {
    span.setAttribute("llm.provider", ctx.provider);
    span.setAttribute("llm.model", ctx.model);
    try {
      const result = await fn();
      const elapsedSec = (Date.now() - start) / 1000;
      ctx.metrics.requestsTotal.labels({ provider: ctx.provider, model: ctx.model, status: "success" }).inc();
      ctx.metrics.latencySeconds.labels({ provider: ctx.provider, model: ctx.model, status: "success" }).observe(elapsedSec);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const elapsedSec = (Date.now() - start) / 1000;
      ctx.metrics.requestsTotal.labels({ provider: ctx.provider, model: ctx.model, status: "error" }).inc();
      ctx.metrics.latencySeconds.labels({ provider: ctx.provider, model: ctx.model, status: "error" }).observe(elapsedSec);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/llm-provider test observability
```

Expected: 3 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/llm-provider/src/observability.ts packages/llm-provider/test/observability.test.ts
git commit -m "feat(llm-provider): OTel tracer + Prometheus metrics for every LLM call"
```

---

### Task 7: `AnthropicProvider.complete()` with prompt-cache blocks

**Files:**
- Create: `packages/llm-provider/src/anthropic.ts`
- Create: `packages/llm-provider/test/anthropic.test.ts`

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider } from "../src/anthropic.js";
import { createProviderMetrics } from "../src/observability.js";
import type { LLMMessage } from "../src/provider.js";

describe("AnthropicProvider.complete", () => {
  it("sends system + messages separately and preserves cache_control", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "text", text: "hello back" }],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 }
    }));
    const sdk = { messages: { create: sdkCreate } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });

    const messages: LLMMessage[] = [
      { role: "system", content: "you are helpful", cache_control: { type: "ephemeral" } },
      { role: "system", content: "graph-context slice goes here", cache_control: { type: "ephemeral" } },
      { role: "user", content: "what's up?" }
    ];
    const result = await provider.complete(messages, { model: "claude-sonnet-4-6", maxTokens: 1024 });

    expect(result.content).toBe("hello back");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.cacheReadInputTokens).toBe(50);

    expect(sdkCreate).toHaveBeenCalledOnce();
    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    // System prompt must be structured array with cache_control blocks (Anthropic's format)
    expect(Array.isArray(call.system)).toBe(true);
    const sys = call.system as Array<Record<string, unknown>>;
    expect(sys).toHaveLength(2);
    expect(sys[0]).toMatchObject({ type: "text", text: "you are helpful", cache_control: { type: "ephemeral" } });
    expect(sys[1]).toMatchObject({ type: "text", text: "graph-context slice goes here", cache_control: { type: "ephemeral" } });
    // User message is under `messages`
    expect((call.messages as Array<{ role: string; content: string }>)[0]).toMatchObject({ role: "user", content: "what's up?" });
  });

  it("translates Anthropic API errors into ProviderError subclasses", async () => {
    const sdkCreate = vi.fn(async () => {
      const err: Error & { status?: number } = new Error("429 rate limited");
      err.status = 429;
      throw err;
    });
    const sdk = { messages: { create: sdkCreate } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });
    await expect(provider.complete([{ role: "user", content: "hi" }], { model: "claude-sonnet-4-6", maxTokens: 100 }))
      .rejects.toMatchObject({ name: "RateLimitError" });
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/llm-provider test anthropic.test
```

- [ ] **Step 3: Implement**

`packages/llm-provider/src/anthropic.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { CircuitBreaker } from "./circuit-breaker.js";
import { InvalidRequestError, NetworkError, ProviderError, RateLimitError } from "./errors.js";
import { instrumentCall, type ProviderMetrics } from "./observability.js";
import type { LLMCallOptions, LLMCompletion, LLMMessage, LLMProvider, LLMStreamChunk } from "./provider.js";
import { resolvePolicy, retry } from "./retry.js";

export interface AnthropicProviderOptions {
  sdk: Anthropic;
  metrics: ProviderMetrics;
  circuitBreakers?: Map<string, CircuitBreaker>;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly sdk: Anthropic;
  private readonly metrics: ProviderMetrics;
  private readonly breakers: Map<string, CircuitBreaker>;

  constructor(opts: AnthropicProviderOptions) {
    this.sdk = opts.sdk;
    this.metrics = opts.metrics;
    this.breakers = opts.circuitBreakers ?? new Map();
  }

  async complete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    const breaker = this.getBreaker(options.model);
    const policy = resolvePolicy(options.retry);
    return instrumentCall(
      { provider: this.name, model: options.model, metrics: this.metrics },
      () => breaker.run(() => retry(() => this.callComplete(messages, options), policy))
    );
  }

  async *stream(messages: LLMMessage[], options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const { system, body } = this.assembleRequest(messages, options);
    const stream = this.sdk.messages.stream({ system, ...body });
    for await (const event of stream) {
      const raw = event as unknown as Record<string, unknown>;
      const kind = raw.type as string | undefined;
      if (kind === "content_block_delta") {
        const delta = (raw.delta as Record<string, unknown>)?.text as string | undefined;
        if (delta) yield { type: "content_delta", delta };
      } else if (kind === "message_delta") {
        const stop = (raw.delta as Record<string, unknown>)?.stop_reason as LLMCompletion["stopReason"] | undefined;
        if (stop) yield { type: "message_stop", stopReason: stop };
      }
    }
  }

  private async callComplete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    try {
      const { system, body } = this.assembleRequest(messages, options);
      const resp = await this.sdk.messages.create({ system, ...body }) as unknown as AnthropicRawResponse;
      return this.parseResponse(resp);
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private assembleRequest(messages: LLMMessage[], options: LLMCallOptions): { system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>; body: Record<string, unknown> } {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => ({
        type: "text" as const,
        text: m.content,
        ...(m.cache_control ? { cache_control: m.cache_control } : {})
      }));
    const userAssistant = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    return {
      system,
      body: {
        model: options.model,
        max_tokens: options.maxTokens,
        messages: userAssistant,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.stopSequences ? { stop_sequences: options.stopSequences } : {})
      }
    };
  }

  private parseResponse(raw: AnthropicRawResponse): LLMCompletion {
    const textBlocks = raw.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    const content = textBlocks.map((b) => b.text).join("");
    return {
      content,
      model: raw.model,
      stopReason: raw.stop_reason,
      usage: {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        cacheCreationInputTokens: raw.usage.cache_creation_input_tokens,
        cacheReadInputTokens: raw.usage.cache_read_input_tokens
      }
    };
  }

  private translateError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const e = err as { status?: number; message?: string };
    const msg = e.message ?? "anthropic error";
    if (e.status === 429) return new RateLimitError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 500) return new NetworkError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 400) return new InvalidRequestError(msg, { cause: err });
    return new NetworkError(msg, { cause: err });
  }

  private getBreaker(model: string): CircuitBreaker {
    const key = `${this.name}:${model}`;
    let existing = this.breakers.get(key);
    if (!existing) {
      existing = new CircuitBreaker({ key, openAfter: 5, halfOpenAfterMs: 30_000 });
      this.breakers.set(key, existing);
    }
    return existing;
  }
}

interface AnthropicRawResponse {
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: LLMCompletion["stopReason"];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/llm-provider test anthropic.test
```

Expected: 2 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/llm-provider/src/anthropic.ts packages/llm-provider/test/anthropic.test.ts
git commit -m "feat(llm-provider): AnthropicProvider.complete with prompt-cache blocks + error translation"
```

---

### Task 8: `AnthropicProvider.stream()` chunk assembly

**Files:**
- Create: `packages/llm-provider/test/anthropic-stream.test.ts`

(Implementation already shipped in Task 7's `anthropic.ts`; this task tests the streaming path.)

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/anthropic-stream.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider } from "../src/anthropic.js";
import { createProviderMetrics } from "../src/observability.js";

describe("AnthropicProvider.stream", () => {
  it("yields content_delta chunks then message_stop", async () => {
    async function* fakeStream() {
      yield { type: "message_start" };
      yield { type: "content_block_delta", delta: { text: "hello " } };
      yield { type: "content_block_delta", delta: { text: "world" } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
    }
    const sdk = { messages: { stream: vi.fn(() => fakeStream()) } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });

    const collected: string[] = [];
    let stopReason: string | undefined;
    for await (const chunk of provider.stream(
      [{ role: "user", content: "hi" }],
      { model: "claude-sonnet-4-6", maxTokens: 100 }
    )) {
      if (chunk.type === "content_delta") collected.push(chunk.delta);
      else if (chunk.type === "message_stop") stopReason = chunk.stopReason;
    }
    expect(collected.join("")).toBe("hello world");
    expect(stopReason).toBe("end_turn");
  });
});
```

- [ ] **Step 2: Run — expect pass (implementation already in place)**
```bash
pnpm -F @atlas/llm-provider test anthropic-stream
```

Expected: 1 pass. If it fails, the streaming path in `anthropic.ts` from Task 7 needs adjustment — fix and re-run before committing.

- [ ] **Step 3: Commit**
```bash
git add packages/llm-provider/test/anthropic-stream.test.ts
git commit -m "test(llm-provider): AnthropicProvider.stream yields deltas and stop reason"
```

---

### Task 9: `GoogleProvider` stub + public index

**Files:**
- Create: `packages/llm-provider/src/google.ts`
- Modify: `packages/llm-provider/src/index.ts`
- Create: `packages/llm-provider/test/google.test.ts`

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/google.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GoogleProvider } from "../src/google.js";

describe("GoogleProvider (D.1 stub)", () => {
  it("is constructable but complete() throws a clear 'deferred to D.3' error", async () => {
    const provider = new GoogleProvider({ apiKey: "fake" });
    expect(provider.name).toBe("google");
    await expect(provider.complete([{ role: "user", content: "hi" }], { model: "gemini-2.5-flash", maxTokens: 100 }))
      .rejects.toThrow(/deferred to D\.3/);
  });

  it("stream() throws the same deferred error", async () => {
    const provider = new GoogleProvider({ apiKey: "fake" });
    const iter = provider.stream([{ role: "user", content: "hi" }], { model: "gemini-2.5-flash", maxTokens: 100 });
    await expect((async () => { for await (const _ of iter) { /* drain */ } })())
      .rejects.toThrow(/deferred to D\.3/);
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/llm-provider test google
```

- [ ] **Step 3: Implement stub**

`packages/llm-provider/src/google.ts`:

```typescript
import type { LLMCallOptions, LLMCompletion, LLMMessage, LLMProvider, LLMStreamChunk } from "./provider.js";

export interface GoogleProviderOptions {
  apiKey: string;
}

// D.1 stub. Real Gemini 2.5 Flash implementation lands with Plan D.3 (Developer-role parallelism).
export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  constructor(_opts: GoogleProviderOptions) {
    // accepted for interface parity; no SDK wired in D.1
  }
  async complete(_messages: LLMMessage[], _options: LLMCallOptions): Promise<LLMCompletion> {
    throw new Error("GoogleProvider.complete is deferred to D.3 — use AnthropicProvider in D.1");
  }
  async *stream(_messages: LLMMessage[], _options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    throw new Error("GoogleProvider.stream is deferred to D.3 — use AnthropicProvider in D.1");
    yield { type: "content_delta", delta: "" }; // unreachable but satisfies return type
  }
}
```

- [ ] **Step 4: Update public index**

`packages/llm-provider/src/index.ts`:

```typescript
export * from "./provider.js";
export * from "./errors.js";
export * from "./retry.js";
export * from "./circuit-breaker.js";
export * from "./observability.js";
export { AnthropicProvider } from "./anthropic.js";
export { GoogleProvider } from "./google.js";
```

- [ ] **Step 5: Run — expect pass**
```bash
pnpm -F @atlas/llm-provider test
```

Expected: all @atlas/llm-provider tests pass (count varies with prior tasks).

- [ ] **Step 6: Commit**
```bash
git add packages/llm-provider/src/google.ts packages/llm-provider/src/index.ts packages/llm-provider/test/google.test.ts
git commit -m "feat(llm-provider): GoogleProvider stub + public index exports"
```

---

### Task 10: Scaffold `packages/conductor/`

**Files:**
- Create: `packages/conductor/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (placeholder)

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p packages/conductor/src packages/conductor/test
```

- [ ] **Step 2: package.json**

`packages/conductor/package.json`:

```json
{
  "name": "@atlas/conductor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/llm-provider": "workspace:*",
    "@atlas/spec-graph-data": "workspace:*",
    "@atlas/spec-graph-schema": "workspace:*",
    "@atlas/skill-runtime": "workspace:*",
    "@opentelemetry/api": "^1.9.0",
    "prom-client": "^15.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: tsconfig.json + vitest.config.ts**

Same shape as `packages/llm-provider/tsconfig.json` and `vitest.config.ts` from Task 1 — copy those verbatim.

- [ ] **Step 4: src/index.ts placeholder**

`packages/conductor/src/index.ts`:

```typescript
export {};
```

- [ ] **Step 5: Install + verify**
```bash
pnpm install
pnpm -F @atlas/conductor typecheck
pnpm -F @atlas/conductor build
```

Expected: both exit 0.

- [ ] **Step 6: Commit**
```bash
git add packages/conductor/ pnpm-lock.yaml
git commit -m "feat(conductor): scaffold package with workspace deps on llm-provider + spec-graph-data + skill-runtime"
```

---

### Task 11: Deterministic graph-slice serialization

**Files:**
- Create: `packages/conductor/src/graph-slice.ts`
- Create: `packages/conductor/test/graph-slice.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/graph-slice.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { serializeSlice, hashSlice } from "../src/graph-slice.js";

const graph = {
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DB" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-20T00:00:00.000Z",
  updatedAt: "2026-04-20T00:00:00.000Z",
  nodes: {
    "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" },
    "page:about": { kind: "page", id: "page:about", path: "/about", title: "About", renderMode: "ssr", routeRef: "GET /about" }
  },
  edges: [
    { type: "renders", from: "page:about", to: "cmp:footer" },
    { type: "renders", from: "page:home", to: "cmp:header" }
  ]
};

describe("serializeSlice / hashSlice", () => {
  it("sorts nodes by id", () => {
    const slice = serializeSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    const order = slice.bytes.match(/"kind":"page","id":"(page:[^"]+)"/g) ?? [];
    expect(order[0]).toContain("page:about"); // lexicographic first
    expect(order[1]).toContain("page:home");
  });

  it("sorts edges by (from, to, type)", () => {
    const slice = serializeSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    const renders = slice.bytes.match(/"from":"page:[^"]+","to":"cmp:[^"]+","type":"renders"/g) ?? [];
    expect(renders[0]).toContain('"from":"page:about"'); // page:about < page:home
    expect(renders[1]).toContain('"from":"page:home"');
  });

  it("hashSlice is deterministic across runs", () => {
    const a = hashSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    const b = hashSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("different graphs produce different hashes", () => {
    const mutated = { ...graph, nodes: { ...graph.nodes, "page:home": { ...graph.nodes["page:home"], title: "Changed" } } };
    const a = hashSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    const b = hashSlice(mutated as never, { includeAllNodes: true, includeAllEdges: true });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/conductor test graph-slice
```

- [ ] **Step 3: Implement**

`packages/conductor/src/graph-slice.ts`:

```typescript
import { createHash } from "node:crypto";
import type { SpecGraph } from "@atlas/spec-graph-schema";

export interface SliceSelector {
  includeAllNodes?: boolean;
  includeAllEdges?: boolean;
  nodeIds?: string[];
  edgeKey?: (e: { from: string; to: string; type: string }) => boolean;
}

export interface SerializedSlice {
  bytes: string; // canonical JSON
  nodeIds: string[];
  edgeCount: number;
}

export function serializeSlice(graph: SpecGraph, selector: SliceSelector): SerializedSlice {
  const allNodeIds = Object.keys(graph.nodes);
  const nodeIds = selector.includeAllNodes
    ? allNodeIds.slice().sort()
    : (selector.nodeIds ?? []).slice().sort();
  const nodes: Array<Record<string, unknown>> = [];
  for (const id of nodeIds) {
    const n = (graph.nodes as Record<string, Record<string, unknown>>)[id];
    if (n) nodes.push(canonicalize(n));
  }
  const edges = (graph.edges as Array<{ from: string; to: string; type: string } & Record<string, unknown>>)
    .filter((e) => selector.includeAllEdges || (selector.edgeKey ? selector.edgeKey(e) : false))
    .slice()
    .sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return 0;
    })
    .map(canonicalize);
  const payload = { nodes, edges };
  const bytes = JSON.stringify(payload);
  return { bytes, nodeIds, edgeCount: edges.length };
}

export function hashSlice(graph: SpecGraph, selector: SliceSelector): string {
  const { bytes } = serializeSlice(graph, selector);
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return sorted;
}
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/conductor test graph-slice
```

Expected: 4 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/conductor/src/graph-slice.ts packages/conductor/test/graph-slice.test.ts
git commit -m "feat(conductor): deterministic graph-slice serialization + SHA-256 hash"
```

---

### Task 12: Prompt-cache 3-tier prefix builder

**Files:**
- Create: `packages/conductor/src/prompt-cache.ts`
- Create: `packages/conductor/test/prompt-cache.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/prompt-cache.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPromptCacheBlocks } from "../src/prompt-cache.js";

describe("buildPromptCacheBlocks", () => {
  it("emits 3 tiers: role system, graph slice (cached), user turn", () => {
    const blocks = buildPromptCacheBlocks({
      rolePrompt: "you are the Architect",
      graphSlice: { bytes: '{"nodes":[],"edges":[]}', hash: "sha256:abc" },
      userTurn: "plan a checkout flow"
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ role: "system", content: expect.stringContaining("Architect"), cache_control: { type: "ephemeral" } });
    expect(blocks[1]).toMatchObject({ role: "system", content: expect.stringContaining('"nodes":[]'), cache_control: { type: "ephemeral" } });
    expect(blocks[2]).toMatchObject({ role: "user", content: "plan a checkout flow" });
    expect(blocks[2].cache_control).toBeUndefined();
  });

  it("graph slice content includes the hash for traceability", () => {
    const blocks = buildPromptCacheBlocks({
      rolePrompt: "sys",
      graphSlice: { bytes: '{"nodes":[],"edges":[]}', hash: "sha256:deadbeef" },
      userTurn: "u"
    });
    expect(blocks[1].content).toContain("sha256:deadbeef");
  });

  it("returns LLMMessage shape compatible with @atlas/llm-provider", () => {
    const blocks = buildPromptCacheBlocks({
      rolePrompt: "r",
      graphSlice: { bytes: "{}", hash: "sha256:x" },
      userTurn: "u"
    });
    for (const b of blocks) {
      expect(["system", "user", "assistant"]).toContain(b.role);
      expect(typeof b.content).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/conductor test prompt-cache
```

- [ ] **Step 3: Implement**

`packages/conductor/src/prompt-cache.ts`:

```typescript
import type { LLMMessage } from "@atlas/llm-provider";

export interface PromptCacheInput {
  rolePrompt: string;
  graphSlice: { bytes: string; hash: string };
  userTurn: string;
}

export function buildPromptCacheBlocks(input: PromptCacheInput): LLMMessage[] {
  return [
    {
      role: "system",
      content: input.rolePrompt,
      cache_control: { type: "ephemeral" }
    },
    {
      role: "system",
      content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>`,
      cache_control: { type: "ephemeral" }
    },
    {
      role: "user",
      content: input.userTurn
    }
  ];
}
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/conductor test prompt-cache
```

Expected: 3 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/conductor/src/prompt-cache.ts packages/conductor/test/prompt-cache.test.ts
git commit -m "feat(conductor): 3-tier prompt-cache prefix (role + graph slice + user turn)"
```

---

### Task 13: Shared task list (typed queue + per-task lock)

**Files:**
- Create: `packages/conductor/src/shared-task-list.ts`
- Create: `packages/conductor/test/shared-task-list.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/shared-task-list.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SharedTaskList } from "../src/shared-task-list.js";

interface TestTask { id: string; label: string; }

describe("SharedTaskList", () => {
  it("enqueue + dequeue in FIFO order", () => {
    const q = new SharedTaskList<TestTask>();
    q.enqueue({ id: "a", label: "first" });
    q.enqueue({ id: "b", label: "second" });
    expect(q.dequeue()?.id).toBe("a");
    expect(q.dequeue()?.id).toBe("b");
    expect(q.dequeue()).toBeUndefined();
  });

  it("lock/unlock prevents dequeue of locked task", () => {
    const q = new SharedTaskList<TestTask>();
    q.enqueue({ id: "a", label: "x" });
    q.enqueue({ id: "b", label: "y" });
    const token = q.lock("a");
    expect(q.dequeue()?.id).toBe("b"); // skipped locked a
    q.unlock("a", token);
    expect(q.dequeue()?.id).toBe("a");
  });

  it("unlock with wrong token throws", () => {
    const q = new SharedTaskList<TestTask>();
    q.enqueue({ id: "a", label: "x" });
    q.lock("a");
    expect(() => q.unlock("a", "wrong-token")).toThrow(/token/);
  });

  it("size() reflects enqueued count minus dequeued", () => {
    const q = new SharedTaskList<TestTask>();
    expect(q.size()).toBe(0);
    q.enqueue({ id: "a", label: "x" });
    q.enqueue({ id: "b", label: "y" });
    expect(q.size()).toBe(2);
    q.dequeue();
    expect(q.size()).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/conductor test shared-task-list
```

- [ ] **Step 3: Implement**

`packages/conductor/src/shared-task-list.ts`:

```typescript
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
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/conductor test shared-task-list
```

Expected: 4 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/conductor/src/shared-task-list.ts packages/conductor/test/shared-task-list.test.ts
git commit -m "feat(conductor): shared task list with per-task lock (skip locked on dequeue)"
```

---

### Task 14: Topic-based peer messaging

**Files:**
- Create: `packages/conductor/src/messaging.ts`
- Create: `packages/conductor/test/messaging.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/messaging.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { MessageBus } from "../src/messaging.js";

describe("MessageBus", () => {
  it("delivers a published message to all subscribers of the topic", async () => {
    const bus = new MessageBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe("role.completed", h1);
    bus.subscribe("role.completed", h2);
    await bus.publish("role.completed", { roleId: "developer", diffHash: "abc" });
    expect(h1).toHaveBeenCalledWith({ roleId: "developer", diffHash: "abc" });
    expect(h2).toHaveBeenCalledWith({ roleId: "developer", diffHash: "abc" });
  });

  it("does not deliver to other topics", async () => {
    const bus = new MessageBus();
    const h = vi.fn();
    bus.subscribe("role.failed", h);
    await bus.publish("role.completed", { x: 1 });
    expect(h).not.toHaveBeenCalled();
  });

  it("unsubscribe stops delivery", async () => {
    const bus = new MessageBus();
    const h = vi.fn();
    const unsub = bus.subscribe("t", h);
    await bus.publish("t", 1);
    unsub();
    await bus.publish("t", 2);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(1);
  });

  it("handler errors do not prevent other handlers from running", async () => {
    const bus = new MessageBus();
    const good = vi.fn();
    bus.subscribe("t", () => { throw new Error("h1 fail"); });
    bus.subscribe("t", good);
    await bus.publish("t", 42);
    expect(good).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/conductor test messaging
```

- [ ] **Step 3: Implement**

`packages/conductor/src/messaging.ts`:

```typescript
export type MessageHandler<T = unknown> = (msg: T) => void | Promise<void>;
export type Unsubscribe = () => void;

export class MessageBus {
  private subscribers = new Map<string, Set<MessageHandler>>();

  subscribe<T = unknown>(topic: string, handler: MessageHandler<T>): Unsubscribe {
    let set = this.subscribers.get(topic);
    if (!set) {
      set = new Set();
      this.subscribers.set(topic, set);
    }
    set.add(handler as MessageHandler);
    return () => {
      set?.delete(handler as MessageHandler);
    };
  }

  async publish<T = unknown>(topic: string, msg: T): Promise<void> {
    const set = this.subscribers.get(topic);
    if (!set) return;
    for (const handler of set) {
      try {
        await handler(msg);
      } catch (err) {
        // at-least-once delivery: a broken handler should not block others.
        // We surface the error via console.error; production wire-up will
        // push to the observability registry (D.4+).
        // eslint-disable-next-line no-console
        console.error(`MessageBus handler for topic ${topic} threw:`, err);
      }
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/conductor test messaging
```

Expected: 4 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/conductor/src/messaging.ts packages/conductor/test/messaging.test.ts
git commit -m "feat(conductor): topic-based MessageBus with at-least-once delivery"
```

---

### Task 15: File lock primitive (lockfile-based, reentrant)

**Files:**
- Create: `packages/conductor/src/file-lock.ts`
- Create: `packages/conductor/test/file-lock.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/file-lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FileLock } from "../src/file-lock.js";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atlas-flock-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("FileLock", () => {
  it("acquire + release creates and removes the lockfile", async () => {
    const lock = new FileLock(join(dir, "a.lock"));
    await lock.acquire();
    await lock.release();
    expect(lock.held).toBe(false);
  });

  it("second acquire in same instance is reentrant (no error, no duplicate file-op)", async () => {
    const lock = new FileLock(join(dir, "a.lock"));
    await lock.acquire();
    await lock.acquire(); // reentrant
    expect(lock.held).toBe(true);
    await lock.release();
    await lock.release(); // safe no-op after initial release (reentrant counting)
  });

  it("a different FileLock for the same path blocks until released", async () => {
    const a = new FileLock(join(dir, "a.lock"));
    const b = new FileLock(join(dir, "a.lock"));
    await a.acquire();
    const bAcquire = b.acquire({ timeoutMs: 200, retryIntervalMs: 20 });
    await expect(bAcquire).rejects.toThrow(/timeout/i);
    await a.release();
    await b.acquire({ timeoutMs: 200, retryIntervalMs: 20 });
    await b.release();
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/conductor test file-lock
```

- [ ] **Step 3: Implement**

`packages/conductor/src/file-lock.ts`:

```typescript
import { openSync, closeSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export interface FileLockAcquireOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
}

export class FileLock {
  private readonly path: string;
  private readonly token: string;
  private depth = 0;

  constructor(path: string) {
    this.path = path;
    this.token = randomUUID();
  }

  get held(): boolean {
    return this.depth > 0;
  }

  async acquire(opts: FileLockAcquireOptions = {}): Promise<void> {
    if (this.depth > 0) {
      this.depth += 1;
      return;
    }
    const timeoutMs = opts.timeoutMs ?? 5_000;
    const retryIntervalMs = opts.retryIntervalMs ?? 50;
    const start = Date.now();
    while (true) {
      try {
        const fd = openSync(this.path, "wx"); // exclusive create; fails if exists
        writeFileSync(fd, JSON.stringify({ token: this.token, pid: process.pid, ts: Date.now() }));
        closeSync(fd);
        this.depth = 1;
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        if (Date.now() - start >= timeoutMs) {
          throw new Error(`FileLock.acquire timeout after ${timeoutMs}ms for ${this.path}`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }
  }

  async release(): Promise<void> {
    if (this.depth === 0) return; // idempotent release
    this.depth -= 1;
    if (this.depth > 0) return;
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}
```

- [ ] **Step 4: Run — expect pass**
```bash
pnpm -F @atlas/conductor test file-lock
```

Expected: 3 pass.

- [ ] **Step 5: Commit**
```bash
git add packages/conductor/src/file-lock.ts packages/conductor/test/file-lock.test.ts
git commit -m "feat(conductor): reentrant file-lock primitive (lockfile-based, timeout-aware)"
```

---

### Task 16: Role interface + `DispatchContext` types + errors

**Files:**
- Create: `packages/conductor/src/role.ts`
- Create: `packages/conductor/src/dispatch-context.ts`
- Create: `packages/conductor/src/retry-policy.ts`
- Create: `packages/conductor/src/errors.ts`
- Create: `packages/conductor/test/role.types.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/role.types.test.ts`:

```typescript
import { describe, it, expect, expectTypeOf } from "vitest";
import { TestRole, type Role, type RoleInvocation, type RoleOutput } from "../src/role.js";
import { type DispatchContext, type RitualId, DispatchContextSchema } from "../src/dispatch-context.js";
import { DEFAULT_DISPATCH_RETRY, STRICT_DISPATCH_RETRY, NO_DISPATCH_RETRY } from "../src/retry-policy.js";
import { RitualEscalatedError } from "../src/errors.js";

describe("Role + DispatchContext types", () => {
  it("Role interface is shaped correctly", () => {
    expectTypeOf<Role["run"]>().returns.toMatchTypeOf<Promise<RoleOutput>>();
  });

  it("TestRole is constructable and returns stubbed output", async () => {
    const role = new TestRole({ roleId: "developer" });
    const out = await role.run({
      ritualId: "r-1",
      intent: "add checkout",
      graphSlice: { bytes: "{}", hash: "sha256:x" },
      userTurn: "please do"
    });
    expect(out.events.length).toBeGreaterThan(0);
  });

  it("DispatchContextSchema validates happy input", () => {
    const ctx: DispatchContext = {
      ritualId: "r-1" as RitualId,
      graphVersion: 1,
      userTurn: "hi",
      projectId: "11111111-1111-4111-8111-111111111111"
    };
    expect(DispatchContextSchema.parse(ctx)).toEqual(ctx);
  });

  it("canonical retry policies expose expected shapes", () => {
    expect(DEFAULT_DISPATCH_RETRY.maxAttempts).toBe(3);
    expect(NO_DISPATCH_RETRY.maxAttempts).toBe(1);
    expect(STRICT_DISPATCH_RETRY.maxAttempts).toBeGreaterThan(3);
  });

  it("RitualEscalatedError carries the failed ritual id", () => {
    const err = new RitualEscalatedError("r-1" as RitualId, "3 consecutive failures");
    expect(err.name).toBe("RitualEscalatedError");
    expect(err.ritualId).toBe("r-1");
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/conductor test role.types
```

- [ ] **Step 3: Implement `src/role.ts`**

```typescript
import { z } from "zod";

export const RoleEventSchema = z.object({
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown())
});
export type RoleEvent = z.infer<typeof RoleEventSchema>;

export const RoleOutputSchema = z.object({
  events: z.array(RoleEventSchema),
  diff: z.object({
    kind: z.enum(["none", "patch"]),
    body: z.string().optional()
  })
});
export type RoleOutput = z.infer<typeof RoleOutputSchema>;

export interface RoleInvocation {
  ritualId: string;
  intent: string;
  graphSlice: { bytes: string; hash: string };
  userTurn: string;
}

export interface Role {
  readonly id: string;
  run(inv: RoleInvocation): Promise<RoleOutput>;
}

// Stub used in tests and for initial end-to-end smoke. Real roles land in D.2–D.5.
export class TestRole implements Role {
  readonly id: string;
  constructor(opts: { roleId: string; onRun?: (inv: RoleInvocation) => Promise<RoleOutput> }) {
    this.id = opts.roleId;
    if (opts.onRun) this.run = opts.onRun;
  }
  async run(inv: RoleInvocation): Promise<RoleOutput> {
    return {
      events: [{ eventType: `${this.id}.ran`, payload: { intent: inv.intent, graphHash: inv.graphSlice.hash } }],
      diff: { kind: "none" }
    };
  }
}
```

- [ ] **Step 4: Implement `src/dispatch-context.ts`**

```typescript
import { z } from "zod";

export const RitualIdSchema = z.string().min(1).brand("RitualId");
export type RitualId = z.infer<typeof RitualIdSchema>;

export const DispatchContextSchema = z.object({
  ritualId: RitualIdSchema,
  graphVersion: z.number().int().nonnegative(),
  userTurn: z.string(),
  projectId: z.string().uuid()
});
export type DispatchContext = z.infer<typeof DispatchContextSchema>;
```

- [ ] **Step 5: Implement `src/retry-policy.ts`**

```typescript
export interface DispatchRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  multiplier: number;
  name: "default" | "none" | "strict";
}

export const DEFAULT_DISPATCH_RETRY: DispatchRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  multiplier: 4,
  name: "default"
};

export const NO_DISPATCH_RETRY: DispatchRetryPolicy = {
  maxAttempts: 1,
  baseDelayMs: 0,
  multiplier: 1,
  name: "none"
};

export const STRICT_DISPATCH_RETRY: DispatchRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 200,
  multiplier: 3,
  name: "strict"
};
```

- [ ] **Step 6: Implement `src/errors.ts`**

```typescript
import type { RitualId } from "./dispatch-context.js";

export class RitualEscalatedError extends Error {
  readonly ritualId: RitualId;
  readonly reason: string;
  constructor(ritualId: RitualId, reason: string) {
    super(`ritual ${ritualId} escalated: ${reason}`);
    this.name = "RitualEscalatedError";
    this.ritualId = ritualId;
    this.reason = reason;
  }
}
```

- [ ] **Step 7: Run — expect pass**
```bash
pnpm -F @atlas/conductor test role.types
```

Expected: 5 pass.

- [ ] **Step 8: Commit**
```bash
git add packages/conductor/src/role.ts packages/conductor/src/dispatch-context.ts packages/conductor/src/retry-policy.ts packages/conductor/src/errors.ts packages/conductor/test/role.types.test.ts
git commit -m "feat(conductor): Role + DispatchContext + RetryPolicy types + RitualEscalatedError"
```

---

### Task 17: `Conductor.dispatch()` happy path

**Files:**
- Create: `packages/conductor/src/conductor.ts`
- Create: `packages/conductor/test/dispatch-happy.test.ts`

The Conductor uses a `CheckpointSink` abstraction so tests can inject an in-memory implementation. D.1 ships only the abstraction — actual `@atlas/spec-graph-data` wiring is in the integration test (Task 21).

- [ ] **Step 1: Write failing test**

`packages/conductor/test/dispatch-happy.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";
import type { DispatchContext } from "../src/dispatch-context.js";

describe("Conductor.dispatch (happy path)", () => {
  it("classifies intent, runs the chosen role, emits events through a checkpoint sink", async () => {
    const classify = vi.fn(async (_userTurn: string) => ({ roleId: "developer", confidence: 0.9 }));
    const checkpoints: unknown[] = [];
    const role = new TestRole({ roleId: "developer" });
    const conductor = new Conductor({
      classifier: { classify },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (evt) => { checkpoints.push(evt); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });

    const ctx: DispatchContext = {
      ritualId: "r-1" as never,
      graphVersion: 0,
      userTurn: "add a checkout page",
      projectId: "11111111-1111-4111-8111-111111111111"
    };
    const out = await conductor.dispatch(ctx);

    expect(classify).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledWith("add a checkout page");
    expect(out.roleId).toBe("developer");
    expect(out.output.events.length).toBeGreaterThan(0);
    // At minimum: classifier result + role-emitted event + dispatch completion are checkpointed
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(checkpoints.some((c) => (c as { eventType: string }).eventType === "dispatch.completed")).toBe(true);
  });

  it("rejects when classifier returns an unknown role id", async () => {
    const classify = vi.fn(async () => ({ roleId: "ghost", confidence: 0.5 }));
    const conductor = new Conductor({
      classifier: { classify },
      roles: new Map(),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });
    await expect(conductor.dispatch({
      ritualId: "r-2" as never,
      graphVersion: 0,
      userTurn: "anything",
      projectId: "11111111-1111-4111-8111-111111111111"
    })).rejects.toThrow(/unknown role.*ghost/);
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/conductor test dispatch-happy
```

- [ ] **Step 3: Implement**

`packages/conductor/src/conductor.ts`:

```typescript
import { RitualEscalatedError } from "./errors.js";
import type { DispatchContext } from "./dispatch-context.js";
import type { Role, RoleOutput } from "./role.js";
import { DEFAULT_DISPATCH_RETRY, type DispatchRetryPolicy } from "./retry-policy.js";

export interface ClassifierResult {
  roleId: string;
  confidence: number;
}

export interface Classifier {
  classify(userTurn: string): Promise<ClassifierResult>;
}

export interface CheckpointEvent {
  eventType: string;
  ritualId: string;
  payload: Record<string, unknown>;
  ts: string;
}

export interface CheckpointSink {
  emit(event: CheckpointEvent): Promise<void>;
}

export interface SliceBuilder {
  (ctx: DispatchContext): { bytes: string; hash: string };
}

export interface ConductorOptions {
  classifier: Classifier;
  roles: Map<string, Role>;
  checkpointSink: CheckpointSink;
  sliceBuilder: SliceBuilder;
  sleep?: (ms: number) => Promise<void>;
}

export interface DispatchResult {
  roleId: string;
  output: RoleOutput;
  attempts: number;
}

export interface DispatchOptions {
  retry?: DispatchRetryPolicy;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Conductor {
  private readonly classifier: Classifier;
  private readonly roles: Map<string, Role>;
  private readonly sink: CheckpointSink;
  private readonly sliceBuilder: SliceBuilder;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: ConductorOptions) {
    this.classifier = opts.classifier;
    this.roles = opts.roles;
    this.sink = opts.checkpointSink;
    this.sliceBuilder = opts.sliceBuilder;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async dispatch(ctx: DispatchContext, options: DispatchOptions = {}): Promise<DispatchResult> {
    const policy = options.retry ?? DEFAULT_DISPATCH_RETRY;
    const classification = await this.classifier.classify(ctx.userTurn);
    await this.emit({ eventType: "dispatch.classified", ctx, payload: { ...classification } });
    const role = this.roles.get(classification.roleId);
    if (!role) {
      await this.emit({ eventType: "dispatch.failed", ctx, payload: { reason: "unknown-role", roleId: classification.roleId } });
      throw new Error(`unknown role: ${classification.roleId}`);
    }

    const slice = this.sliceBuilder(ctx);
    const invocation = {
      ritualId: ctx.ritualId as string,
      intent: classification.roleId,
      graphSlice: slice,
      userTurn: ctx.userTurn
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        const output = await role.run(invocation);
        for (const evt of output.events) {
          await this.emit({
            eventType: evt.eventType,
            ctx,
            payload: { ...evt.payload, attempt, roleId: role.id }
          });
        }
        await this.emit({ eventType: "dispatch.completed", ctx, payload: { roleId: role.id, attempts: attempt } });
        return { roleId: role.id, output, attempts: attempt };
      } catch (err) {
        lastError = err;
        await this.emit({
          eventType: "role.failed",
          ctx,
          payload: { roleId: role.id, attempt, message: (err as Error).message }
        });
        if (attempt === policy.maxAttempts) break;
        const delay = policy.baseDelayMs * Math.pow(policy.multiplier, attempt - 1);
        await this.sleep(delay);
      }
    }

    await this.emit({
      eventType: "ritual.escalated",
      ctx,
      payload: { roleId: role.id, attempts: policy.maxAttempts, finalError: (lastError as Error | undefined)?.message }
    });
    throw new RitualEscalatedError(ctx.ritualId, `role ${role.id} failed ${policy.maxAttempts} times`);
  }

  private async emit(input: { eventType: string; ctx: DispatchContext; payload: Record<string, unknown> }): Promise<void> {
    await this.sink.emit({
      eventType: input.eventType,
      ritualId: input.ctx.ritualId as string,
      payload: input.payload,
      ts: new Date().toISOString()
    });
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

`packages/conductor/src/index.ts`:

```typescript
export * from "./role.js";
export * from "./dispatch-context.js";
export * from "./retry-policy.js";
export * from "./errors.js";
export * from "./conductor.js";
export * from "./graph-slice.js";
export * from "./prompt-cache.js";
export * from "./shared-task-list.js";
export * from "./messaging.js";
export * from "./file-lock.js";
```

- [ ] **Step 5: Run — expect pass**
```bash
pnpm -F @atlas/conductor test dispatch-happy
```

Expected: 2 pass.

- [ ] **Step 6: Commit**
```bash
git add packages/conductor/src/conductor.ts packages/conductor/src/index.ts packages/conductor/test/dispatch-happy.test.ts
git commit -m "feat(conductor): Conductor.dispatch happy path with checkpoint sink"
```

---

### Task 18: Retry success (first attempt fails transiently, second succeeds)

**Files:**
- Create: `packages/conductor/test/dispatch-retry-success.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/dispatch-retry-success.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";

describe("Conductor.dispatch (retry success)", () => {
  it("recovers when first attempt throws transient error", async () => {
    let attempts = 0;
    const failingThenSucceeds = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient boom");
      return { events: [{ eventType: "developer.ran", payload: {} }], diff: { kind: "none" as const } };
    };
    const role = new TestRole({ roleId: "developer", onRun: failingThenSucceeds });
    const events: unknown[] = [];

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (e) => { events.push(e); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {} // instant retry for test speed
    });

    const result = await conductor.dispatch({
      ritualId: "r-3" as never,
      graphVersion: 0,
      userTurn: "ok",
      projectId: "11111111-1111-4111-8111-111111111111"
    });

    expect(result.attempts).toBe(2);
    expect(attempts).toBe(2);
    // First attempt should have logged role.failed; completion should have logged dispatch.completed
    const types = (events as Array<{ eventType: string }>).map((e) => e.eventType);
    expect(types).toContain("role.failed");
    expect(types).toContain("dispatch.completed");
  });
});
```

- [ ] **Step 2: Run — expect pass (implementation already in place from T17)**
```bash
pnpm -F @atlas/conductor test dispatch-retry-success
```

Expected: 1 pass. If the assertion on `attempts === 2` fails, verify the loop in `conductor.ts` correctly increments `attempt` on retry rather than restarting.

- [ ] **Step 3: Commit**
```bash
git add packages/conductor/test/dispatch-retry-success.test.ts
git commit -m "test(conductor): dispatch recovers on transient role failure"
```

---

### Task 19: Retry exhausted (3 failures → escalation)

**Files:**
- Create: `packages/conductor/test/dispatch-retry-exhausted.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/dispatch-retry-exhausted.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";
import { RitualEscalatedError } from "../src/errors.js";

describe("Conductor.dispatch (retry exhausted)", () => {
  it("throws RitualEscalatedError after 3 failed attempts and emits ritual.escalated", async () => {
    let attempts = 0;
    const alwaysFails = async () => {
      attempts += 1;
      throw new Error("persistent boom");
    };
    const role = new TestRole({ roleId: "developer", onRun: alwaysFails });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (e) => { events.push(e as never); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {}
    });

    await expect(conductor.dispatch({
      ritualId: "r-4" as never,
      graphVersion: 0,
      userTurn: "fail",
      projectId: "11111111-1111-4111-8111-111111111111"
    })).rejects.toBeInstanceOf(RitualEscalatedError);

    expect(attempts).toBe(3);
    const failed = events.filter((e) => e.eventType === "role.failed");
    expect(failed).toHaveLength(3);
    const escalated = events.find((e) => e.eventType === "ritual.escalated");
    expect(escalated).toBeDefined();
    expect((escalated?.payload as { attempts: number }).attempts).toBe(3);
  });
});
```

- [ ] **Step 2: Run — expect pass (implementation in place)**
```bash
pnpm -F @atlas/conductor test dispatch-retry-exhausted
```

Expected: 1 pass.

- [ ] **Step 3: Commit**
```bash
git add packages/conductor/test/dispatch-retry-exhausted.test.ts
git commit -m "test(conductor): dispatch escalates after 3 consecutive role failures"
```

---

### Task 20: Per-dispatch retry-policy injection

**Files:**
- Create: `packages/conductor/test/dispatch-retry-policy.test.ts`

- [ ] **Step 1: Write failing test**

`packages/conductor/test/dispatch-retry-policy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";
import { NO_DISPATCH_RETRY, STRICT_DISPATCH_RETRY } from "../src/retry-policy.js";

describe("Conductor.dispatch (retry policy injection)", () => {
  it("NO_DISPATCH_RETRY fails on the first error without retrying", async () => {
    let attempts = 0;
    const role = new TestRole({
      roleId: "developer",
      onRun: async () => { attempts += 1; throw new Error("one-shot fail"); }
    });
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {}
    });
    await expect(conductor.dispatch(
      { ritualId: "r-5" as never, graphVersion: 0, userTurn: "x", projectId: "11111111-1111-4111-8111-111111111111" },
      { retry: NO_DISPATCH_RETRY }
    )).rejects.toThrow(/escalated/i);
    expect(attempts).toBe(1);
  });

  it("STRICT_DISPATCH_RETRY gives more than 3 attempts", async () => {
    let attempts = 0;
    const role = new TestRole({
      roleId: "developer",
      onRun: async () => {
        attempts += 1;
        if (attempts < 4) throw new Error("still going");
        return { events: [{ eventType: "developer.ran", payload: {} }], diff: { kind: "none" as const } };
      }
    });
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {}
    });
    const result = await conductor.dispatch(
      { ritualId: "r-6" as never, graphVersion: 0, userTurn: "x", projectId: "11111111-1111-4111-8111-111111111111" },
      { retry: STRICT_DISPATCH_RETRY }
    );
    expect(result.attempts).toBe(4);
  });
});
```

- [ ] **Step 2: Run — expect pass**
```bash
pnpm -F @atlas/conductor test dispatch-retry-policy
```

Expected: 2 pass.

- [ ] **Step 3: Commit**
```bash
git add packages/conductor/test/dispatch-retry-policy.test.ts
git commit -m "test(conductor): per-dispatch retry-policy injection (none + strict)"
```

---

### Task 21: End-to-end integration test

**Files:**
- Create: `packages/conductor/test/integration.test.ts`

Integration test with an in-memory checkpoint sink, a real `SharedTaskList`, a `MessageBus`, the `TestRole`, and a real mocked-SDK `AnthropicProvider` round-trip through the prompt-cache prefix builder. No DB, no real Anthropic calls.

- [ ] **Step 1: Write the test**

`packages/conductor/test/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { Conductor } from "../src/conductor.js";
import { TestRole, type RoleInvocation } from "../src/role.js";
import { MessageBus } from "../src/messaging.js";
import { SharedTaskList } from "../src/shared-task-list.js";
import { buildPromptCacheBlocks } from "../src/prompt-cache.js";

describe("integration: classify → role run → prompt-cache → llm-provider", () => {
  it("produces a classified, retried, completed dispatch that calls the mocked Anthropic SDK", async () => {
    // Mock the Anthropic SDK
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "text", text: "Developer says: done." }],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    // Role that actually calls the provider through the prompt-cache assembler
    const role = new TestRole({
      roleId: "developer",
      onRun: async (inv: RoleInvocation) => {
        const blocks = buildPromptCacheBlocks({
          rolePrompt: "you are the Developer",
          graphSlice: inv.graphSlice,
          userTurn: inv.userTurn
        });
        const completion = await provider.complete(blocks, { model: "claude-sonnet-4-6", maxTokens: 1024 });
        return {
          events: [{ eventType: "developer.completion", payload: { text: completion.content } }],
          diff: { kind: "none" as const }
        };
      }
    });

    const bus = new MessageBus();
    const queue = new SharedTaskList<{ id: string; role: string }>();
    queue.enqueue({ id: "ritual-1", role: "developer" });

    const checkpoints: Array<{ eventType: string }> = [];
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 0.95 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (e) => { checkpoints.push(e); await bus.publish(e.eventType, e); } },
      sliceBuilder: () => ({ bytes: '{"nodes":[],"edges":[]}', hash: "sha256:zero" }),
      sleep: async () => {}
    });

    let sawCompletion = false;
    bus.subscribe<{ payload: { text: string } }>("developer.completion", (evt) => {
      if (evt.payload.text.includes("done")) sawCompletion = true;
    });

    const result = await conductor.dispatch({
      ritualId: "ritual-1" as never,
      graphVersion: 1,
      userTurn: "ship it",
      projectId: "11111111-1111-4111-8111-111111111111"
    });

    expect(result.roleId).toBe("developer");
    expect(result.output.events[0].eventType).toBe("developer.completion");
    expect(sdkCreate).toHaveBeenCalledOnce();
    const req = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    const sys = req.system as Array<Record<string, unknown>>;
    // 3-tier: role + graph slice in system, user turn in messages
    expect(sys).toHaveLength(2);
    expect((req.messages as Array<Record<string, unknown>>)[0]).toMatchObject({ role: "user", content: "ship it" });
    expect(sawCompletion).toBe(true);
    expect(checkpoints.some((c) => c.eventType === "dispatch.completed")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect pass (integration hits every prior task)**
```bash
pnpm -F @atlas/conductor test integration
```

Expected: 1 pass. If a shape mismatch fires (e.g., Anthropic message format), the fix is in the specific component's code — not in this test.

- [ ] **Step 3: Commit**
```bash
git add packages/conductor/test/integration.test.ts
git commit -m "test(conductor): end-to-end dispatch integration via AnthropicProvider mock"
```

---

### Task 22: READMEs + plan index update

**Files:**
- Create: `packages/llm-provider/README.md`
- Create: `packages/conductor/README.md`
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Write `packages/llm-provider/README.md`**

```markdown
# @atlas/llm-provider

Multi-provider LLM abstraction for Atlas. Shipped in Plan D.1 with an Anthropic implementation + a Google stub.

## Install

Workspace package (not published):

```ts
import { AnthropicProvider, createProviderMetrics, type LLMProvider } from "@atlas/llm-provider";
```

## Providers

- `AnthropicProvider` — wraps `@anthropic-ai/sdk` with prompt-cache awareness, observability (OTel + Prometheus), exponential-backoff retry, and a circuit breaker that opens after 5 consecutive failures.
- `GoogleProvider` — D.1 stub; throws on call. Real Gemini wiring ships with Plan D.3.

## Retry + circuit-breaker contract

- Default policy: 3 attempts max, backoff 100 → 400 → 1600 ms, transient errors only.
- Per-call override via `LLMCallOptions.retry = "none" | "default" | "strict"`.
- Circuit breaker keyed on `{ provider, model }`; opens after 5 failures, half-opens after 30 seconds.

## Observability

Every call emits an OpenTelemetry span (`llm.{provider}.call`) and increments `atlas_llm_provider_requests_total{provider,model,status}` + records latency in `atlas_llm_provider_latency_seconds`.
```

- [ ] **Step 2: Write `packages/conductor/README.md`**

```markdown
# @atlas/conductor

Thin conductor that classifies intent, composes role invocations, and manages retry + checkpointing. Shipped in Plan D.1. Role packages (`@atlas/role-architect`, `-developer`, `-security`, `-accessibility`) land with D.2–D.5.

## Install

Workspace package. Depends on `@atlas/llm-provider`, `@atlas/spec-graph-data`, `@atlas/spec-graph-schema`, `@atlas/skill-runtime`.

## Usage sketch

```ts
import { Conductor, buildPromptCacheBlocks, type DispatchContext } from "@atlas/conductor";

const conductor = new Conductor({
  classifier: skillRuntimeClassifier, // injected from @atlas/skill-runtime (C.1)
  roles: new Map([["developer", developerRole]]), // real roles arrive with D.2–D.5
  checkpointSink: specGraphDataCheckpointSink, // wired to @atlas/spec-graph-data.spec_events
  sliceBuilder: (ctx) => hashSlice(currentGraph, { includeAllNodes: true })
});

await conductor.dispatch(context, { retry: DEFAULT_DISPATCH_RETRY });
```

## What lands in D.1

- `Conductor` with `dispatch(ctx, options?)` — classifies, runs role, retries transient failures, escalates after 3 consecutive failures.
- Deterministic graph-slice serialization + SHA-256 hash for prompt-cache keys.
- 3-tier prompt-cache prefix assembler.
- Shared task list, topic-based message bus, file-lock primitive.
- Role interface + `TestRole` stub.

## What does NOT land in D.1

- Real role implementations (D.2–D.5).
- Real Gemini provider (D.3).
- Parallel-Developer voting (D.3).
- Real `@atlas/spec-graph-data` integration (this package ships the `CheckpointSink` interface; the adapter is wired when the first role package lands).
```

- [ ] **Step 3: Update plan index**

Edit `docs/superpowers/plans/README.md`'s `## Plan index` table. Insert a new row after the C.1 row (add C.1 row first if absent):

```
| 7 | `2026-04-20-conductor-llm-abstraction.md` | **D.1 — Conductor + LLM Provider** | Thin Conductor with classify → role → retry → escalate; `@atlas/llm-provider` with AnthropicProvider (Google stub); 3-tier prompt-cache; deterministic graph-slice hash | 22 tasks, TDD | Ready to execute |
```

Renumber subsequent directional-plan rows so the numbers stay contiguous.

Also in the Phase A execution-order ASCII diagram, add a line showing D.1 depends on B.2 and C.1:

```
            └─ Unit D — Conductor + Roles (Plans[7], ready)
                 ├─ Unit E …
```

Adjust Plans[...] cross-references as needed.

- [ ] **Step 4: Build + typecheck + test everything**
```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

Expected: everything still green.

- [ ] **Step 5: Commit**
```bash
git add packages/llm-provider/README.md packages/conductor/README.md docs/superpowers/plans/README.md
git commit -m "docs(conductor,llm-provider,plans): add READMEs and D.1 plan index entry"
```

---

## Completion Checklist

After all 22 tasks:

- [ ] `pnpm -F @atlas/llm-provider test` — all tests green
- [ ] `pnpm -F @atlas/conductor test` — all tests green
- [ ] `pnpm -r build` — every package builds
- [ ] `pnpm -r typecheck` — every package typechecks
- [ ] `pnpm -r test` — no regressions across B.1, B.2, any shipped package
- [ ] `AnthropicProvider` successfully round-trips a mocked request with `cache_control` blocks
- [ ] `GoogleProvider` throws a clear "deferred to D.3" error
- [ ] `Conductor.dispatch` happy path, retry-success, retry-exhausted, and retry-policy-injection tests all green
- [ ] Integration test runs the full pipeline (classify → slice → prompt-cache → mocked SDK → events)
- [ ] Plan index + READMEs updated

## Handoff to D.2 / D.3 / D.4 / D.5

The Conductor is role-agnostic — every downstream role plan simply:

1. Creates `packages/role-{architect,developer,security,accessibility}/` with its composed skills.
2. Imports `Conductor`, `Role`, `type RoleInvocation`, `type RoleOutput` from `@atlas/conductor`.
3. Implements `Role.run()` — usually by assembling a prompt via `buildPromptCacheBlocks`, calling `AnthropicProvider.complete()` (or `.stream()`), and mapping the completion into `RoleOutput` events.
4. Registers itself in the `roles` map passed to the `Conductor` constructor.

Cross-cutting concerns already solved in D.1 and reused without modification:

- Observability: every LLM call emits an OTel span + Prometheus metric.
- Retry: library-level by default; role passes `{ retry: "none" }` for non-retryable calls.
- Checkpointing: role-emitted events flow through the `CheckpointSink` to `@atlas/spec-graph-data`.
- Escalation: retry-exhausted is observable via the `ritual.escalated` event and is the signal the Unit E ritual engine needs to surface to the user (PRD §9.5).

**D.3 (Developer role)** additionally needs: real Gemini wiring inside `GoogleProvider`, a Reviewer sub-role for voting, and parallelism orchestration across two providers. D.1's `Conductor.dispatch` pattern generalises cleanly; D.3 adds a new `ParallelConductor` (or composes two dispatches) without modifying the single-provider path shipped here.
