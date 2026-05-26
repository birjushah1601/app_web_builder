import type { DependencyProfile } from "@atlas/workflow-engine";

export function ossFirstDefaults(): DependencyProfile {
  return {
    schemaVersion: "1",
    auth: { provider: "keycloak" },
    db: { provider: "postgres", connectionStringEnvVar: "DATABASE_URL" },
    storage: { provider: "minio", bucketEnvVar: "S3_BUCKET" },
    email: { provider: "mailpit" },
    jobs: { provider: "bullmq", redisUrlEnvVar: "REDIS_URL" },
    payments: { provider: "lago" },
    search: { provider: "meilisearch", apiKeyEnvVar: "MEILI_KEY" },
    errorTracking: { provider: "glitchtip", dsnEnvVar: "GLITCHTIP_DSN" },
    analytics: { provider: "posthog", apiKeyEnvVar: "POSTHOG_KEY" },
    featureFlags: { provider: "unleash", urlEnvVar: "UNLEASH_URL" }
  };
}

/**
 * Heuristic: examine the prompt for concern keywords and return only the
 * relevant subset of DependencyProfile keys. E.g. a "blog landing page"
 * prompt returns a profile without payments/jobs/search.
 */
export function inferRelevantConcerns(prompt: string): Array<keyof DependencyProfile> {
  const concerns: Array<keyof DependencyProfile> = [];
  const lower = prompt.toLowerCase();
  if (/\b(login|users?|accounts?|auth|sign[- ]?(in|up)|sso)\b/.test(lower)) concerns.push("auth");
  if (/\b(db|database|persistent|users?|records?|history|notes?)\b/.test(lower)) concerns.push("db");
  if (/\b(upload|files?|images?|attachments?|storage|s3)\b/.test(lower)) concerns.push("storage");
  if (/\b(email|notify|notifications?|magic[- ]?link)\b/.test(lower)) concerns.push("email");
  if (/\b(job|queue|worker|cron|scheduled|background)\b/.test(lower)) concerns.push("jobs");
  if (/\b(pay|subscription|billing|stripe|invoice|plan)\b/.test(lower)) concerns.push("payments");
  if (/\b(search|find|filter|index)\b/.test(lower)) concerns.push("search");
  return concerns;
}
