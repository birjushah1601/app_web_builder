# Developer Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/role-developer/` — the second concrete `Role` implementation for `@atlas/conductor`. The Developer role generates code diffs from an Architect-emitted artifact via **parallel two-provider dispatch** (Anthropic Sonnet 4.6 + Google Gemini 2.5 Flash) with a lightweight **Reviewer pass** (Sonnet) that votes between the two outputs and emits the winner. Skills composed: `tdd-feature.md` + `edit-only-what-changed.md` + `runnable-plan.md`. This plan also **upgrades `@atlas/llm-provider`'s `GoogleProvider` from D.1's stub to a real implementation** — the Gemini SDK was deliberately left as a throwing stub in D.1; D.3 wires the real `@google/generative-ai` SDK.

**Architecture:** A single new pnpm-workspace package implementing `Role` from `@atlas/conductor`. Inputs: `RoleInvocation` carrying the Architect's `ArchitectOutput` artifact (passed via `userTurn` in serialized form OR a typed `extras` field). Outputs: `RoleOutput.diff = { kind: "patch", body: <unified diff> }` plus events. Internal flow:

1. Compose the three skills via the same `assembleArchitectPrompt`-style helper from D.2 (extracted into `@atlas/role-shared` if more than one role uses it; for D.3 we inline a `assembleDeveloperPrompt`).
2. Dispatch in parallel to Anthropic + Google via `Promise.allSettled`. Each gets a `tool-use` schema constraining output to `DeveloperOutput { diff, summary, testsAdded[] }`.
3. If one fails (provider error, schema fail), the other wins by walkover.
4. If both succeed, run a Reviewer pass (Sonnet, third provider call) with both outputs in the prompt; Reviewer emits `{ winner: "anthropic" | "google", reasoning }` via tool-use.
5. Emit events: `developer.dispatch.started`, `developer.anthropic.completed`/`failed`, `developer.google.completed`/`failed`, `developer.reviewer.voted` (only if both succeeded), `developer.completed`.

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS · `@google/generative-ai` latest · existing `@anthropic-ai/sdk`. Workspace deps: `@atlas/conductor`, `@atlas/llm-provider`, `@atlas/skill-runtime`, `@atlas/spec-graph-schema`. New external runtime dep: `@google/generative-ai`.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans D.1 + D.2 + C.1 + C.2 + B.1 merged.
- Node 22 LTS + pnpm 9+.
- Reviewer-role doesn't need its own package; it's a thin function inside `role-developer` calling the same `LLMProvider` interface.
- No real Anthropic/Google API keys required — all provider calls mocked in tests.

---

## File Structure

```
packages/
  llm-provider/                              # MODIFIED — replace GoogleProvider stub
    package.json                             # +@google/generative-ai dep
    src/
      google.ts                              # FULL impl: complete + completeWithToolUse + stream
    test/
      google.test.ts                         # 4 new tests (was 2 stub tests)
      google-tools.test.ts                   # NEW — tool-use round-trip

  role-developer/                            # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts
      types.ts                               # DeveloperOutput Zod, ReviewerVote Zod, DeveloperInvocation
      assemble-prompt.ts                     # composes tdd-feature + edit-only-what-changed + runnable-plan
      anthropic-pass.ts                      # Sonnet 4.6 + tool-use → DeveloperOutput
      google-pass.ts                         # Gemini 2.5 Flash + tool-use → DeveloperOutput
      reviewer-vote.ts                       # Sonnet vote between two DeveloperOutputs → winner
      role.ts                                # DeveloperRole class implementing Role
      errors.ts
    test/
      types.test.ts
      assemble-prompt.test.ts
      anthropic-pass.test.ts
      google-pass.test.ts
      reviewer-vote.test.ts
      role-happy-both-succeed.test.ts
      role-walkover-anthropic-fails.test.ts
      role-walkover-google-fails.test.ts
      role-both-fail.test.ts
      observability.test.ts
      conductor-fit.test.ts
      fixtures/
        skills/
          tdd-feature.md
          edit-only-what-changed.md
          runnable-plan.md

docs/superpowers/plans/
  README.md                                  # MODIFIED — add D.3 entry
```

## Open-question resolutions

- **D.1 OQ4 (parallel Developer voting) → lightweight Reviewer-role pass (Sonnet) inside D.3.** Not a separate package (yet). The Reviewer is a function `reviewerVote(anthropicOutput, googleOutput, llm) → { winner, reasoning }` using tool-use to constrain output. If the Reviewer call itself fails, fall back to the **Anthropic** output as default winner (Sonnet is the canonical Atlas dev-model per PRD §11.3).
- **Provider model defaults.** `DEVELOPER_ANTHROPIC_MODEL = "claude-sonnet-4-6"`, `DEVELOPER_GOOGLE_MODEL = "gemini-2.5-flash"`, `DEVELOPER_REVIEWER_MODEL = "claude-sonnet-4-6"`. Overridable per-construction.
- **`DeveloperOutput` shape.** `{ diff: string (unified-diff), summary: string, testsAdded: string[] (file paths), filesModified: string[] }`. Both providers must produce this shape via tool-use.
- **Skills are passed as fixture stubs in tests.** Production wires through `@atlas/skill-library`'s real `tdd-feature` / `edit-only-what-changed` / `runnable-plan` markdown.

---

## Tasks

### Task 1: Upgrade `GoogleProvider` from stub to real Gemini wiring

**Files:** modify `packages/llm-provider/package.json` + `src/google.ts` + `test/google.test.ts` + new `test/google-tools.test.ts`.

- [ ] **Step 1: Add `@google/generative-ai` dep**

Edit `packages/llm-provider/package.json`. Add to `dependencies`:

```json
    "@google/generative-ai": "^0.21.0"
```

Run `pnpm install` to lock.

- [ ] **Step 2: Write failing tests** in `packages/llm-provider/test/google.test.ts` (replace the stub-throwing tests):

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { GoogleProvider, createProviderMetrics } from "../src/index.js";

describe("GoogleProvider.complete", () => {
  it("calls Gemini SDK with mapped messages and returns LLMCompletion", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "hello back",
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hello back" }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 }
      }
    }));
    const getGenerativeModel = vi.fn(() => ({ generateContent }));
    const sdk = { getGenerativeModel } as never;

    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const result = await provider.complete(
      [{ role: "user", content: "say hi" }],
      { model: "gemini-2.5-flash", maxTokens: 256 }
    );

    expect(result.content).toBe("hello back");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(6);
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: "gemini-2.5-flash", generationConfig: { maxOutputTokens: 256 } });
  });

  it("translates Gemini API errors into ProviderError subclasses", async () => {
    const generateContent = vi.fn(async () => {
      const err: Error & { status?: number } = new Error("429 rate limited");
      err.status = 429;
      throw err;
    });
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await expect(provider.complete([{ role: "user", content: "hi" }], { model: "gemini-2.5-flash", maxTokens: 100 }))
      .rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("merges system messages into the first user turn (Gemini has no separate system role)", async () => {
    const generateContent = vi.fn(async () => ({
      response: { text: () => "ok", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 } }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await provider.complete(
      [
        { role: "system", content: "You are a coder" },
        { role: "system", content: "Output a unified diff" },
        { role: "user", content: "rename foo to bar" }
      ],
      { model: "gemini-2.5-flash", maxTokens: 256 }
    );

    const call = generateContent.mock.calls[0][0] as Record<string, unknown>;
    const contents = call.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe("user");
    const merged = contents[0].parts[0].text;
    expect(merged).toContain("You are a coder");
    expect(merged).toContain("Output a unified diff");
    expect(merged).toContain("rename foo to bar");
  });
});
```

- [ ] **Step 3: Run — expect fail**

```bash
pnpm -F @atlas/llm-provider test google.test
```

- [ ] **Step 4: Implement real `google.ts`** — replace the stub:

```typescript
import type { GoogleGenerativeAI } from "@google/generative-ai";
import { CircuitBreaker } from "./circuit-breaker.js";
import { InvalidRequestError, NetworkError, ProviderError, RateLimitError } from "./errors.js";
import { instrumentCall, type ProviderMetrics } from "./observability.js";
import type { LLMCallOptions, LLMCompletion, LLMMessage, LLMProvider, LLMStreamChunk } from "./provider.js";
import { resolvePolicy, retry } from "./retry.js";

export interface GoogleProviderOptions {
  sdk: GoogleGenerativeAI;
  metrics: ProviderMetrics;
  circuitBreakers?: Map<string, CircuitBreaker>;
}

export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  private readonly sdk: GoogleGenerativeAI;
  private readonly metrics: ProviderMetrics;
  private readonly breakers: Map<string, CircuitBreaker>;

  constructor(opts: GoogleProviderOptions) {
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

  async *stream(_messages: LLMMessage[], _options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    throw new Error("GoogleProvider.stream is not yet implemented (use complete for D.3 voting)");
    yield { type: "content_delta", delta: "" }; // unreachable; satisfies type
  }

  private async callComplete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    try {
      const model = this.sdk.getGenerativeModel({
        model: options.model,
        generationConfig: { maxOutputTokens: options.maxTokens, ...(options.temperature !== undefined ? { temperature: options.temperature } : {}) }
      });
      const contents = mapMessages(messages);
      const resp = (await model.generateContent({ contents })) as unknown as GeminiRawResponse;
      return {
        content: resp.response.text(),
        model: options.model,
        stopReason: mapStopReason(resp.response.candidates?.[0]?.finishReason),
        usage: {
          inputTokens: resp.response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: resp.response.usageMetadata?.candidatesTokenCount ?? 0
        }
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private translateError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const e = err as { status?: number; message?: string };
    const msg = e.message ?? "google provider error";
    if (e.status === 429) return new RateLimitError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 500) return new NetworkError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 400) return new InvalidRequestError(msg, { cause: err });
    return new NetworkError(msg, { cause: err });
  }

  private getBreaker(model: string): CircuitBreaker {
    const key = `${this.name}:${model}`;
    let b = this.breakers.get(key);
    if (!b) {
      b = new CircuitBreaker({ key, openAfter: 5, halfOpenAfterMs: 30_000 });
      this.breakers.set(key, b);
    }
    return b;
  }
}

interface GeminiRawResponse {
  response: {
    text(): string;
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
}

function mapStopReason(reason: string | undefined): LLMCompletion["stopReason"] {
  switch (reason) {
    case "MAX_TOKENS": return "max_tokens";
    case "STOP": return "end_turn";
    case "STOP_SEQUENCE": return "stop_sequence";
    default: return "end_turn";
  }
}

function mapMessages(messages: LLMMessage[]): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  // Gemini has no system role. Merge all leading system messages into the first user turn.
  const systemTexts: string[] = [];
  const out: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  let firstUserHandled = false;
  for (const m of messages) {
    if (m.role === "system") {
      systemTexts.push(m.content);
      continue;
    }
    if (m.role === "user") {
      if (!firstUserHandled && systemTexts.length > 0) {
        out.push({ role: "user", parts: [{ text: [...systemTexts, m.content].join("\n\n") }] });
        firstUserHandled = true;
      } else {
        out.push({ role: "user", parts: [{ text: m.content }] });
      }
    } else {
      out.push({ role: "model", parts: [{ text: m.content }] });
    }
  }
  // If we never saw a user turn but had system messages, push them as a single user turn.
  if (!firstUserHandled && systemTexts.length > 0 && out.length === 0) {
    out.push({ role: "user", parts: [{ text: systemTexts.join("\n\n") }] });
  }
  return out;
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm -F @atlas/llm-provider test google.test
```

Expected: 3 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-provider/package.json packages/llm-provider/src/google.ts packages/llm-provider/test/google.test.ts pnpm-lock.yaml
git commit -m "feat(llm-provider): real GoogleProvider — Gemini SDK wiring with system-merge + error translation"
```

---

### Task 2: `GoogleProvider.completeWithToolUse` via Gemini's function-calling

**Files:** modify `packages/llm-provider/src/google.ts` + new `test/google-tools.test.ts`.

Gemini's function-calling differs from Anthropic's tool-use shape. We map the existing `ToolUseOptions` (defined for Anthropic in D.1/D.2) to Gemini's `Tool`/`FunctionDeclaration` API and parse the response's `functionCalls` array.

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/google-tools.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { GoogleProvider, createProviderMetrics } from "../src/index.js";

describe("GoogleProvider.completeWithToolUse", () => {
  it("returns the tool_use input when the model calls the tool", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "emit_developer_output", args: { diff: "@@ +1 line", summary: "renamed", testsAdded: [], filesModified: ["a.ts"] } } }] } }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "@@ +1 line", summary: "renamed", testsAdded: [], filesModified: ["a.ts"] } }]
      }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const result = await provider.completeWithToolUse(
      [{ role: "user", content: "rename foo to bar" }],
      {
        model: "gemini-2.5-flash",
        maxTokens: 1024,
        tools: [{
          name: "emit_developer_output",
          description: "Emit the developer output",
          input_schema: {
            type: "object",
            properties: { diff: { type: "string" }, summary: { type: "string" }, testsAdded: { type: "array", items: { type: "string" } }, filesModified: { type: "array", items: { type: "string" } } },
            required: ["diff", "summary", "testsAdded", "filesModified"]
          }
        }],
        toolChoice: { type: "tool", name: "emit_developer_output" }
      }
    );

    expect(result.toolName).toBe("emit_developer_output");
    expect(result.input).toMatchObject({ diff: "@@ +1 line", summary: "renamed" });
  });

  it("throws when the model emits text without a function call", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "I cannot use the tool",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
        functionCalls: () => []
      }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await expect(provider.completeWithToolUse(
      [{ role: "user", content: "do it" }],
      {
        model: "gemini-2.5-flash", maxTokens: 100,
        tools: [{ name: "emit_developer_output", description: "x", input_schema: { type: "object", properties: {} } }],
        toolChoice: { type: "tool", name: "emit_developer_output" }
      }
    )).rejects.toThrow(/tool/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/llm-provider test google-tools
```

- [ ] **Step 3: Add `completeWithToolUse` to `GoogleProvider`** in `src/google.ts`:

```typescript
async completeWithToolUse(
  messages: LLMMessage[],
  options: import("./provider.js").ToolUseOptions
): Promise<import("./provider.js").ToolUseResult> {
  const breaker = this.getBreaker(options.model);
  const policy = resolvePolicy(options.retry);
  return instrumentCall(
    { provider: this.name, model: options.model, metrics: this.metrics },
    () => breaker.run(() => retry(() => this.callWithToolUse(messages, options), policy))
  );
}

private async callWithToolUse(
  messages: LLMMessage[],
  options: import("./provider.js").ToolUseOptions
): Promise<import("./provider.js").ToolUseResult> {
  try {
    const model = this.sdk.getGenerativeModel({
      model: options.model,
      generationConfig: { maxOutputTokens: options.maxTokens },
      tools: [{
        functionDeclarations: options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema as never
        }))
      }],
      toolConfig: options.toolChoice.type === "tool"
        ? { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [options.toolChoice.name] } }
        : { functionCallingConfig: { mode: "AUTO" } }
    });
    const contents = mapMessages(messages);
    const resp = (await model.generateContent({ contents })) as unknown as GeminiRawResponse & {
      response: { functionCalls?: () => Array<{ name: string; args: unknown }> | undefined };
    };
    const calls = resp.response.functionCalls?.() ?? [];
    const first = calls[0];
    if (!first) {
      throw new InvalidRequestError("expected functionCall response, got plain text or empty");
    }
    return {
      toolName: first.name,
      input: first.args,
      stopReason: mapStopReason(resp.response.candidates?.[0]?.finishReason),
      usage: {
        inputTokens: resp.response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: resp.response.usageMetadata?.candidatesTokenCount ?? 0
      }
    };
  } catch (err) {
    throw this.translateError(err);
  }
}
```

- [ ] **Step 4: Run — expect pass + commit**

```bash
pnpm -F @atlas/llm-provider test
git add packages/llm-provider/src/google.ts packages/llm-provider/test/google-tools.test.ts
git commit -m "feat(llm-provider): GoogleProvider.completeWithToolUse via Gemini function-calling"
```

---

### Task 3: Scaffold `packages/role-developer/`

**Files:** package.json, tsconfig, vitest.config, src/index.ts, test/fixtures/skills/.

- [ ] **Step 1: Tree**

```bash
mkdir -p packages/role-developer/src packages/role-developer/test/fixtures/skills
```

- [ ] **Step 2: package.json**

```json
{
  "name": "@atlas/role-developer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "@atlas/skill-runtime": "workspace:*",
    "@atlas/spec-graph-schema": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "prom-client": "^15.1.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: tsconfig + vitest** (same shape as packages/role-architect/).
- [ ] **Step 4: src/index.ts placeholder** `export {};`
- [ ] **Step 5: Verify + commit**

```bash
pnpm install && pnpm -F @atlas/role-developer typecheck
git add packages/role-developer/ pnpm-lock.yaml
git commit -m "feat(role-developer): scaffold package with workspace deps + prom-client devDep"
```

---

### Task 4: `DeveloperOutput` + `ReviewerVote` + `DeveloperInvocation` types

**Files:** `src/types.ts` + `test/types.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { DeveloperOutputSchema, ReviewerVoteSchema, type DeveloperOutput } from "../src/types.js";

describe("D.3 types", () => {
  it("DeveloperOutputSchema parses a valid diff payload", () => {
    const out: DeveloperOutput = {
      diff: "@@ -1 +1 @@\n-foo\n+bar\n",
      summary: "Renamed foo to bar in one file",
      testsAdded: ["test/rename.test.ts"],
      filesModified: ["src/foo.ts"]
    };
    expect(DeveloperOutputSchema.parse(out)).toEqual(out);
  });

  it("rejects DeveloperOutput with empty diff", () => {
    expect(() => DeveloperOutputSchema.parse({ diff: "", summary: "x", testsAdded: [], filesModified: ["a.ts"] })).toThrow();
  });

  it("ReviewerVoteSchema parses anthropic + google + reasoning", () => {
    expect(ReviewerVoteSchema.parse({ winner: "anthropic", reasoning: "tighter test coverage" })).toMatchObject({ winner: "anthropic" });
    expect(ReviewerVoteSchema.parse({ winner: "google", reasoning: "smaller diff, same test" })).toMatchObject({ winner: "google" });
  });

  it("rejects ReviewerVote with empty reasoning", () => {
    expect(() => ReviewerVoteSchema.parse({ winner: "anthropic", reasoning: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { z } from "zod";

export const DeveloperOutputSchema = z.object({
  diff: z.string().min(1),
  summary: z.string().min(1),
  testsAdded: z.array(z.string()),
  filesModified: z.array(z.string()).min(1)
});
export type DeveloperOutput = z.infer<typeof DeveloperOutputSchema>;

export const ReviewerVoteSchema = z.object({
  winner: z.enum(["anthropic", "google"]),
  reasoning: z.string().min(1)
});
export type ReviewerVote = z.infer<typeof ReviewerVoteSchema>;

export interface DeveloperInvocation {
  ritualId: string;
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  /** Architect-emitted artifact, JSON-serialized into the prompt. */
  architectArtifact: unknown;
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -F @atlas/role-developer test types
git add packages/role-developer/src/types.ts packages/role-developer/test/types.test.ts
git commit -m "feat(role-developer): DeveloperOutput + ReviewerVote Zod types"
```

---

### Task 5: `assembleDeveloperPrompt(skills)` helper + 3 fixture skills

**Files:** `src/assemble-prompt.ts` + `test/assemble-prompt.test.ts` + `test/fixtures/skills/{tdd-feature,edit-only-what-changed,runnable-plan}.md`.

- [ ] **Step 1: Write 3 fixture skills** (minimal) — same pattern as D.2's fixtures. Each ~10 lines with valid frontmatter (`name`, `description`, optional `activate_on: build`).

- [ ] **Step 2: Write failing test** (mirror D.2's assemble-prompt.test.ts pattern; test that all 3 names resolve and SkillMissingError fires when one is absent).

- [ ] **Step 3: Implement** (copy D.2's `assembleArchitectPrompt` shape, rename to `assembleDeveloperPrompt`):

```typescript
import type { SkillRegistry } from "@atlas/skill-runtime";
import { SkillMissingError } from "./errors.js";

export function assembleDeveloperPrompt(registry: SkillRegistry, skillNames: string[]): string {
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = registry.get(name);
    if (!skill) throw new SkillMissingError(name);
    sections.push(`## Skill: ${name}\n\n${skill.body.trim()}\n`);
  }
  return sections.join("\n---\n\n");
}
```

(Implement `errors.ts` with `DeveloperRoleError`, `SkillMissingError`, `BothProvidersFailedError`, `ReviewerFailedError`.)

- [ ] **Step 4: Run + commit**

```bash
pnpm -F @atlas/role-developer test assemble-prompt
git add packages/role-developer/src/assemble-prompt.ts packages/role-developer/src/errors.ts packages/role-developer/test/assemble-prompt.test.ts packages/role-developer/test/fixtures/
git commit -m "feat(role-developer): assembleDeveloperPrompt + error hierarchy + fixture skills"
```

---

### Task 6: `anthropicPass()` — Sonnet path

**Files:** `src/anthropic-pass.ts` + `test/anthropic-pass.test.ts`.

- [ ] **Step 1: Write failing test** (mirror D.2's triage.test.ts pattern; mock the SDK; assert call shape includes the assembled-skill system prompt + the architect artifact in the user turn + tool-use forcing `emit_developer_output`).

- [ ] **Step 2: Implement**

```typescript
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleDeveloperPrompt } from "./assemble-prompt.js";
import { DeveloperOutputSchema, type DeveloperOutput } from "./types.js";

export const DEVELOPER_ANTHROPIC_MODEL = "claude-sonnet-4-6";

const DEVELOPER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    diff: { type: "string" },
    summary: { type: "string" },
    testsAdded: { type: "array", items: { type: "string" } },
    filesModified: { type: "array", items: { type: "string" } }
  },
  required: ["diff", "summary", "testsAdded", "filesModified"]
} as const;

export interface AnthropicPassInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  userTurn: string;
  architectArtifact: unknown;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function anthropicPass(input: AnthropicPassInput): Promise<DeveloperOutput> {
  const skillPrompt = assembleDeveloperPrompt(input.skills, ["tdd-feature", "edit-only-what-changed", "runnable-plan"]);
  const systemPrompt = `You are the Atlas Developer (Anthropic Sonnet pass). Generate a unified diff that implements the Architect's runnable plan.\n\n${skillPrompt}`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: `User intent: ${input.userTurn}\n\nArchitect artifact:\n${JSON.stringify(input.architectArtifact, null, 2)}` }
  ];
  const result = await (input.llm as unknown as {
    completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
  }).completeWithToolUse(messages, {
    model: input.model ?? DEVELOPER_ANTHROPIC_MODEL,
    maxTokens: 8192,
    tools: [{ name: "emit_developer_output", description: "Emit the diff + summary + tests", input_schema: DEVELOPER_TOOL_SCHEMA }],
    toolChoice: { type: "tool", name: "emit_developer_output" }
  });
  return DeveloperOutputSchema.parse(result.input);
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -F @atlas/role-developer test anthropic-pass
git add packages/role-developer/src/anthropic-pass.ts packages/role-developer/test/anthropic-pass.test.ts
git commit -m "feat(role-developer): anthropicPass via Sonnet 4.6 + tool-use → DeveloperOutput"
```

---

### Task 7: `googlePass()` — Gemini path

**Files:** `src/google-pass.ts` + `test/google-pass.test.ts`.

Identical structure to `anthropicPass` but uses `DEVELOPER_GOOGLE_MODEL = "gemini-2.5-flash"`. The same `completeWithToolUse` API is now real on `GoogleProvider` (T2). Test mocks the same way; impl identical to `anthropicPass` but with the model constant swapped.

- [ ] **Steps 1-3: Same shape as Task 6**

```bash
git add packages/role-developer/src/google-pass.ts packages/role-developer/test/google-pass.test.ts
git commit -m "feat(role-developer): googlePass via Gemini 2.5 Flash + tool-use → DeveloperOutput"
```

---

### Task 8: `reviewerVote()` — Sonnet picks winner between two outputs

**Files:** `src/reviewer-vote.ts` + `test/reviewer-vote.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { reviewerVote, DEVELOPER_REVIEWER_MODEL } from "../src/reviewer-vote.js";

describe("reviewerVote", () => {
  it("returns the LLM's vote with reasoning", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu-vote", name: "emit_reviewer_vote", input: { winner: "google", reasoning: "smaller diff with equivalent coverage" } }],
      model: DEVELOPER_REVIEWER_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 10 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const vote = await reviewerVote({
      llm,
      anthropicOutput: { diff: "anth diff", summary: "a", testsAdded: [], filesModified: ["x.ts"] },
      googleOutput: { diff: "gog diff", summary: "g", testsAdded: [], filesModified: ["x.ts"] }
    });
    expect(vote.winner).toBe("google");
    expect(vote.reasoning).toContain("smaller diff");
  });

  it("forces tool-use to emit_reviewer_vote (no free-form text)", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_reviewer_vote", input: { winner: "anthropic", reasoning: "ok" } }],
      model: DEVELOPER_REVIEWER_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 1 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await reviewerVote({
      llm,
      anthropicOutput: { diff: "a", summary: "a", testsAdded: [], filesModified: ["a"] },
      googleOutput: { diff: "g", summary: "g", testsAdded: [], filesModified: ["g"] }
    });
    const body = sdkCreate.mock.calls[0][0] as { tool_choice?: { type: string; name: string } };
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_reviewer_vote" });
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { ReviewerVoteSchema, type DeveloperOutput, type ReviewerVote } from "./types.js";
import { ReviewerFailedError } from "./errors.js";

export const DEVELOPER_REVIEWER_MODEL = "claude-sonnet-4-6";

const REVIEWER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    winner: { type: "string", enum: ["anthropic", "google"] },
    reasoning: { type: "string" }
  },
  required: ["winner", "reasoning"]
} as const;

export interface ReviewerInput {
  llm: LLMProvider;
  anthropicOutput: DeveloperOutput;
  googleOutput: DeveloperOutput;
  model?: string;
}

export async function reviewerVote(input: ReviewerInput): Promise<ReviewerVote> {
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are the Atlas Reviewer. Two providers (Anthropic Sonnet, Google Gemini Flash) generated competing diffs for the same task. Pick the winner based on: (a) test coverage, (b) diff minimality, (c) adherence to the runnable plan, (d) edit-only-what-changed discipline. Use the emit_reviewer_vote tool exactly once.`
    },
    {
      role: "user",
      content: `=== Anthropic output ===\n${JSON.stringify(input.anthropicOutput, null, 2)}\n\n=== Google output ===\n${JSON.stringify(input.googleOutput, null, 2)}`
    }
  ];
  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: input.model ?? DEVELOPER_REVIEWER_MODEL,
      maxTokens: 1024,
      tools: [{ name: "emit_reviewer_vote", description: "Emit the winning provider + reasoning", input_schema: REVIEWER_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_reviewer_vote" }
    });
  } catch (err) {
    throw new ReviewerFailedError("reviewer LLM call failed", { cause: err });
  }
  const parse = ReviewerVoteSchema.safeParse(result.input);
  if (!parse.success) throw new ReviewerFailedError("reviewer tool_use payload failed schema", { cause: parse.error });
  return parse.data;
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -F @atlas/role-developer test reviewer-vote
git add packages/role-developer/src/reviewer-vote.ts packages/role-developer/test/reviewer-vote.test.ts
git commit -m "feat(role-developer): reviewerVote — Sonnet picks winner via tool-use"
```

---

### Task 9: `DeveloperRole.run()` happy path (both succeed → reviewer votes)

**Files:** `src/role.ts` + `src/index.ts` + `test/role-happy-both-succeed.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole.run (both providers succeed)", () => {
  it("dispatches both providers in parallel and emits reviewer.voted + completed", async () => {
    const anthropicCreate = vi.fn()
      // Developer Anthropic pass
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output", input: { diff: "anth diff", summary: "a", testsAdded: ["t1.ts"], filesModified: ["a.ts"] } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 }
      })
      // Reviewer pass
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu2", name: "emit_reviewer_vote", input: { winner: "anthropic", reasoning: "tighter test" } }],
        model: "claude-sonnet-4-6", stop_reason: "tool_use",
        usage: { input_tokens: 80, output_tokens: 8 }
      });
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    const googleGenerate = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "emit_developer_output", args: { diff: "gog diff", summary: "g", testsAdded: ["t2.ts"], filesModified: ["a.ts"] } } }] } }],
        usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "gog diff", summary: "g", testsAdded: ["t2.ts"], filesModified: ["a.ts"] } }]
      }
    }));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });
    const out = await role.run({
      ritualId: "r-d-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "rename foo to bar"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("developer.dispatch.started");
    expect(types).toContain("developer.anthropic.completed");
    expect(types).toContain("developer.google.completed");
    expect(types).toContain("developer.reviewer.voted");
    expect(types).toContain("developer.completed");
    expect(out.diff.kind).toBe("patch");
    expect(out.diff.body).toBe("anth diff"); // reviewer picked anthropic
  });
});
```

- [ ] **Step 2: Implement `role.ts`**

```typescript
import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { anthropicPass, DEVELOPER_ANTHROPIC_MODEL } from "./anthropic-pass.js";
import { googlePass, DEVELOPER_GOOGLE_MODEL } from "./google-pass.js";
import { reviewerVote, DEVELOPER_REVIEWER_MODEL } from "./reviewer-vote.js";
import { BothProvidersFailedError } from "./errors.js";
import type { DeveloperOutput } from "./types.js";

export interface DeveloperRoleOptions {
  anthropic: LLMProvider;
  google: LLMProvider;
  reviewer: LLMProvider; // typically same as anthropic; injected for testing
  skills: SkillRegistry;
  anthropicModel?: string;
  googleModel?: string;
  reviewerModel?: string;
}

export class DeveloperRole implements Role {
  readonly id = "developer";
  private readonly opts: DeveloperRoleOptions;
  constructor(opts: DeveloperRoleOptions) { this.opts = opts; }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({ eventType: "developer.dispatch.started", payload: { ritualId: inv.ritualId } });

    const anthropicTask = anthropicPass({
      llm: this.opts.anthropic, skills: this.opts.skills,
      userTurn: inv.userTurn, architectArtifact: null, graphSlice: inv.graphSlice,
      model: this.opts.anthropicModel ?? DEVELOPER_ANTHROPIC_MODEL
    }).then((output): { provider: "anthropic"; status: "ok"; output: DeveloperOutput } => ({ provider: "anthropic", status: "ok", output }))
      .catch((err: Error): { provider: "anthropic"; status: "error"; error: Error } => ({ provider: "anthropic", status: "error", error: err }));

    const googleTask = googlePass({
      llm: this.opts.google, skills: this.opts.skills,
      userTurn: inv.userTurn, architectArtifact: null, graphSlice: inv.graphSlice,
      model: this.opts.googleModel ?? DEVELOPER_GOOGLE_MODEL
    }).then((output): { provider: "google"; status: "ok"; output: DeveloperOutput } => ({ provider: "google", status: "ok", output }))
      .catch((err: Error): { provider: "google"; status: "error"; error: Error } => ({ provider: "google", status: "error", error: err }));

    const [anthropicResult, googleResult] = await Promise.all([anthropicTask, googleTask]);

    if (anthropicResult.status === "ok") {
      events.push({ eventType: "developer.anthropic.completed", payload: { summary: anthropicResult.output.summary } });
    } else {
      events.push({ eventType: "developer.anthropic.failed", payload: { error: anthropicResult.error.message } });
    }
    if (googleResult.status === "ok") {
      events.push({ eventType: "developer.google.completed", payload: { summary: googleResult.output.summary } });
    } else {
      events.push({ eventType: "developer.google.failed", payload: { error: googleResult.error.message } });
    }

    let winner: DeveloperOutput;
    if (anthropicResult.status === "ok" && googleResult.status === "ok") {
      let vote;
      try {
        vote = await reviewerVote({
          llm: this.opts.reviewer,
          anthropicOutput: anthropicResult.output,
          googleOutput: googleResult.output,
          model: this.opts.reviewerModel ?? DEVELOPER_REVIEWER_MODEL
        });
        events.push({ eventType: "developer.reviewer.voted", payload: { winner: vote.winner, reasoning: vote.reasoning } });
      } catch (err) {
        // Reviewer failure → default to Anthropic per OQ4
        events.push({ eventType: "developer.reviewer.failed_defaulting_anthropic", payload: { error: (err as Error).message } });
        winner = anthropicResult.output;
        events.push({ eventType: "developer.completed", payload: { summary: winner.summary, picked: "anthropic-default" } });
        return { events, diff: { kind: "patch", body: winner.diff } };
      }
      winner = vote.winner === "anthropic" ? anthropicResult.output : googleResult.output;
    } else if (anthropicResult.status === "ok") {
      winner = anthropicResult.output;
      events.push({ eventType: "developer.walkover", payload: { picked: "anthropic", reason: "google-failed" } });
    } else if (googleResult.status === "ok") {
      winner = googleResult.output;
      events.push({ eventType: "developer.walkover", payload: { picked: "google", reason: "anthropic-failed" } });
    } else {
      events.push({ eventType: "developer.both_failed", payload: { anthropicError: anthropicResult.error.message, googleError: googleResult.error.message } });
      throw new BothProvidersFailedError("Both Anthropic and Google providers failed", { causes: [anthropicResult.error, googleResult.error] });
    }

    events.push({ eventType: "developer.completed", payload: { summary: winner.summary } });
    return { events, diff: { kind: "patch", body: winner.diff } };
  }
}
```

Update `src/errors.ts` to add `BothProvidersFailedError` (with `causes: Error[]`).

- [ ] **Step 3: Update `src/index.ts`** with the public surface (DeveloperRole, types, helpers).
- [ ] **Step 4: Run + commit**

```bash
pnpm -F @atlas/role-developer test role-happy
git add packages/role-developer/src/role.ts packages/role-developer/src/errors.ts packages/role-developer/src/index.ts packages/role-developer/test/role-happy-both-succeed.test.ts
git commit -m "feat(role-developer): DeveloperRole — parallel Sonnet+Gemini + Reviewer voting"
```

---

### Task 10: Walkover paths (one provider fails → other wins, no reviewer)

**Files:** `test/role-walkover-anthropic-fails.test.ts`, `test/role-walkover-google-fails.test.ts`.

- [ ] **Step 1: Write tests** — each mocks one provider to throw, asserts no reviewer call (mocked SDK calls === 1, not 2), and `developer.walkover` event emitted with correct `picked` value.

- [ ] **Step 2: Run + commit**

```bash
pnpm -F @atlas/role-developer test role-walkover
git add packages/role-developer/test/role-walkover-anthropic-fails.test.ts packages/role-developer/test/role-walkover-google-fails.test.ts
git commit -m "test(role-developer): walkover when one provider fails — no reviewer call"
```

---

### Task 11: `role-both-fail.test.ts` — BothProvidersFailedError

**Files:** `test/role-both-fail.test.ts`.

- [ ] **Step 1: Write test** — both providers throw; assert `developer.both_failed` event + `BothProvidersFailedError` raised + no reviewer call.

```bash
pnpm -F @atlas/role-developer test role-both-fail
git add packages/role-developer/test/role-both-fail.test.ts
git commit -m "test(role-developer): BothProvidersFailedError when both providers fail"
```

---

### Task 12: Reviewer-failure default (defaults to Anthropic)

**Files:** add `test/role-reviewer-fails-defaults-anthropic.test.ts`.

- [ ] **Step 1: Write test** — both providers succeed but Reviewer throws; assert `developer.reviewer.failed_defaulting_anthropic` event + diff body equals Anthropic's diff.

```bash
pnpm -F @atlas/role-developer test role-reviewer-fails
git add packages/role-developer/test/role-reviewer-fails-defaults-anthropic.test.ts
git commit -m "test(role-developer): reviewer failure defaults to Anthropic per OQ4"
```

---

### Task 13: Observability — both providers emit metrics

**Files:** `test/observability.test.ts`.

- [ ] **Step 1: Write test** — both providers' metrics increments are observed in a shared Prometheus registry.

```bash
pnpm -F @atlas/role-developer test observability
git add packages/role-developer/test/observability.test.ts
git commit -m "test(role-developer): both Anthropic+Google emit labelled Prometheus metrics"
```

---

### Task 14: Conductor-fit — `Conductor.dispatch` invokes DeveloperRole

**Files:** `test/conductor-fit.test.ts`.

- [ ] **Step 1: Write test** following D.2's `conductor-fit.test.ts` pattern. `Conductor.dispatch` with `roleId: "developer"` returns DeveloperRole's diff + events.

```bash
pnpm -F @atlas/role-developer test conductor-fit
git add packages/role-developer/test/conductor-fit.test.ts
git commit -m "test(role-developer): satisfies @atlas/conductor.Role under Conductor.dispatch"
```

---

### Task 15: Build + workspace smoke

```bash
pnpm -F @atlas/role-developer build && pnpm -F @atlas/role-developer typecheck && pnpm -F @atlas/role-developer test
pnpm -r test
git commit --allow-empty -m "chore(role-developer): full-suite smoke green post D.3"
```

---

### Task 16: README

**Files:** `packages/role-developer/README.md`.

Document: parallel two-provider dispatch, Reviewer vote, walkover semantics, observability, what's out of scope (no real role-developer package consumer yet — the Conductor wires it via E.2's `getRitualEngine` factory in a follow-up).

```bash
git add packages/role-developer/README.md
git commit -m "docs(role-developer): README — parallel dispatch, Reviewer voting, walkover, observability"
```

---

### Task 17: Plan index update

Insert D.3 row in `docs/superpowers/plans/README.md` after D.2:

```
| 1X | `2026-04-21-role-developer.md` | **D.3 — Developer role (parallel Sonnet+Gemini + Reviewer voting)** | Parallel two-provider code-gen + Reviewer pass; real `GoogleProvider` (Gemini SDK + tool-use); walkover semantics + BothProvidersFailedError | 17 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

Renumber subsequent rows (directional docs +1). Update Phase A exit checklist to include D.3.

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add D.3 role-developer to plan index + exit checklist"
```

---

## Completion Checklist

After all 17 tasks:

- [ ] `pnpm -F @atlas/llm-provider test` — green; new `google.test` + `google-tools.test` pass
- [ ] `pnpm -F @atlas/role-developer test` — green (~22 tests across 11 files)
- [ ] `pnpm -r test` — no NEW regressions
- [ ] `DeveloperRole` parallel-dispatches both providers, Reviewer votes when both succeed, walkover when one fails, `BothProvidersFailedError` when both fail
- [ ] Reviewer-failure defaults to Anthropic per OQ4
- [ ] `GoogleProvider` is now a real Gemini SDK consumer (not D.1's stub)
- [ ] Plan index lists D.3 as shipped (pending merge)

## Handoff to D.4 / D.5

D.4 (Security role) and D.5 (Accessibility role) follow the same template:
- Single-provider (no parallelism — they're merge-gate runners, not generators)
- Compose their respective skills from `@atlas/skill-library`
- Implement the `Role` interface AND a concrete `GateRunner` from `@atlas/gate-scheduler` (for the L4 / L5 layers)
- Emit per-pass events
- Return `RoleOutput.diff = { kind: "none" }` (they don't generate code; they validate)

Reuse:
- `assembleDeveloperPrompt`-style helper (extract to `@atlas/role-shared` if D.4/D.5/etc reuse it; otherwise inline)
- The `BothProvidersFailedError` / `ReviewerFailedError` pattern is single-provider — use `RoleError` base instead
- Observability via `@atlas/llm-provider`'s instrumentation
