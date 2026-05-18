# @atlas/video-kling

Kling (klingai.com) adapter for Atlas's video-generation feature. Per ADR-001 §6, Kling is Atlas's v1 video provider — this package is the SDK Atlas uses when `ATLAS_FF_VIDEO_KLING` is on.

## Contents

- `KlingClient` — thin HTTP wrapper around Kling's `/videos/generations` API. `submit()` + `getJob()`. No polling loop — callers own retry / cancel / parallelism decisions.
- `KlingGenerateInputSchema` / `KlingJobSchema` — Zod schemas for the API boundary.
- `KlingCostCap` + `checkKlingCostCap(projectId, reader, cap)` — per-project monthly USD cap with a warn threshold. Mirrors `@atlas/sandbox-e2b`'s `checkSpendCap` so both spend-caps can share one ledger.
- Errors: `KlingError`, `KlingApiError`, `KlingJobFailedError`, `KlingCostCapExceededError`.

## Usage

```ts
import { KlingClient, checkKlingCostCap } from "@atlas/video-kling";

const kling = new KlingClient({ apiKey: process.env.KLING_API_KEY! });

// Before submitting, enforce the spend cap.
await checkKlingCostCap(projectId, spendReader, { capUsd: 50, warnFraction: 0.8 });

const job = await kling.submit({
  prompt: "sunrise over the Pacific, drone shot, cinematic",
  durationSec: 5,
  aspectRatio: "16:9",
  idempotencyKey: `ritual-${ritualId}`
});
// Poll for completion in the caller.
let current = job;
while (current.status === "queued" || current.status === "running") {
  await new Promise((r) => setTimeout(r, 2000));
  current = await kling.getJob(current.jobId);
}
if (current.status === "succeeded") {
  // record current.usageUsd to the spend ledger
  // persist current.videoUrl to the MediaAsset node
}
```

## Seams for tests

Both `fetchFn` (in `KlingClient`) and the `KlingSpendReader` interface are injectable — tests mock both without reaching out to Kling.

## Feature flag

- `ATLAS_FF_VIDEO_KLING` gates the video generation UI + Server Actions in atlas-web. The client itself is flag-agnostic — call sites check the flag.
- `KLING_API_KEY` is required for the client to work in production; tests pass `apiKey: "test"` + a stubbed `fetchFn`.

## Non-goals

- **Multi-provider fallback.** v1 is Kling-only. A future adapter package can follow this shape for Seedance / Runway if the cost-cap economics change.
- **Polling / retry / parallelism.** The caller owns those decisions. `KlingClient` is one-request-per-call.
- **Content moderation.** Kling enforces its own content policy; Atlas runs no client-side moderation. If a prompt fails Kling's policy, the job status flips to `failed` and `errorMessage` explains.

## ADR reference

ADR-001 §6 (2026-04-22). See also D13 in `docs/superpowers/known-deferrals.md`.
