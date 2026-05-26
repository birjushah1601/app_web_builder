import { describe, it, expect } from "vitest";
import { DependencyProfileSchema } from "../src/types.js";

describe("DependencyProfileSchema v1", () => {
  it("accepts the OSS-first defaults profile", () => {
    const profile = {
      schemaVersion: "1",
      auth: { provider: "keycloak", config: { realm: "atlas-user-app" } },
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
    expect(DependencyProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("rejects unknown auth provider", () => {
    const bad = { schemaVersion: "1", auth: { provider: "not-a-real-thing" } };
    expect(DependencyProfileSchema.safeParse(bad).success).toBe(false);
  });

  it("schemaVersion must be literal '1'", () => {
    const bad = { schemaVersion: "2", auth: { provider: "keycloak" } };
    expect(DependencyProfileSchema.safeParse(bad).success).toBe(false);
  });
});
