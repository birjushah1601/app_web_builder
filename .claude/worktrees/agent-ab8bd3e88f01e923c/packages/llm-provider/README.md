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
