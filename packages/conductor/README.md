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
