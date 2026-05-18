import {
  KlingGenerateInputSchema,
  KlingJobSchema,
  type KlingGenerateInput,
  type KlingJob
} from "./types.js";
import { KlingApiError } from "./errors.js";

export interface KlingClientOptions {
  /** Kling API key — `KLING_API_KEY` in production. */
  apiKey: string;
  /** Optional override. Defaults to https://api.klingai.com/v1. */
  baseUrl?: string;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
}

/**
 * Thin client over Kling's public HTTP API. Two operations:
 * - submit(input): POST to /videos/generations → returns a job id + queued status
 * - getJob(jobId): GET /videos/generations/{id} → returns current job status
 *
 * The caller is responsible for polling getJob() until the job settles.
 * Nothing in this package waits — polling loops live in consumer code so
 * retry / cancel / parallelism decisions stay above this layer.
 */
export class KlingClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: KlingClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.klingai.com/v1").replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async submit(input: KlingGenerateInput): Promise<KlingJob> {
    const parsed = KlingGenerateInputSchema.parse(input);
    const body = {
      model: parsed.model,
      prompt: parsed.prompt,
      negative_prompt: parsed.negativePrompt,
      duration: parsed.durationSec,
      aspect_ratio: parsed.aspectRatio,
      image_url: parsed.imageUrl
    };
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
      accept: "application/json"
    };
    if (parsed.idempotencyKey) headers["idempotency-key"] = parsed.idempotencyKey;

    const res = await this.fetchFn(`${this.baseUrl}/videos/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new KlingApiError(`Kling submit failed: HTTP ${res.status}`, {
        statusCode: res.status
      });
    }
    return normalizeJob(await res.json());
  }

  async getJob(jobId: string): Promise<KlingJob> {
    const res = await this.fetchFn(`${this.baseUrl}/videos/generations/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" }
    });
    if (!res.ok) {
      throw new KlingApiError(`Kling getJob failed: HTTP ${res.status}`, {
        statusCode: res.status
      });
    }
    return normalizeJob(await res.json());
  }
}

/**
 * Normalize Kling's snake_case API response into our camelCase KlingJob.
 * Defensive — Kling can return extra fields; we ignore them.
 */
function normalizeJob(raw: unknown): KlingJob {
  const r = raw as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const candidate = {
    jobId: typeof r.id === "string" ? r.id : typeof r.job_id === "string" ? r.job_id : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
    videoUrl: typeof r.video_url === "string" ? r.video_url : undefined,
    thumbnailUrl: typeof r.thumbnail_url === "string" ? r.thumbnail_url : undefined,
    actualDurationSec: typeof r.duration === "number" ? r.duration : undefined,
    errorMessage: typeof r.error_message === "string" ? r.error_message : undefined,
    usageUsd: typeof r.usage_usd === "number" ? r.usage_usd : undefined,
    submittedAtIso: typeof r.submitted_at === "string" ? r.submitted_at : nowIso,
    updatedAtIso: typeof r.updated_at === "string" ? r.updated_at : nowIso
  };
  const parse = KlingJobSchema.safeParse(candidate);
  if (!parse.success) {
    throw new KlingApiError(
      `Kling response failed schema: ${JSON.stringify(parse.error.issues)}`
    );
  }
  return parse.data;
}
