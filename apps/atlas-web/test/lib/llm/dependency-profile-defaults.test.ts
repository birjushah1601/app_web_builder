import { describe, it, expect } from "vitest";
import { ossFirstDefaults, inferRelevantConcerns } from "@/lib/llm/dependency-profile-defaults";

describe("ossFirstDefaults", () => {
  it("returns all expected OSS providers", () => {
    const profile = ossFirstDefaults();
    expect(profile.schemaVersion).toBe("1");
    expect(profile.auth?.provider).toBe("keycloak");
    expect(profile.db?.provider).toBe("postgres");
    expect(profile.storage?.provider).toBe("minio");
    expect(profile.email?.provider).toBe("mailpit");
    expect(profile.jobs?.provider).toBe("bullmq");
    expect(profile.payments?.provider).toBe("lago");
    expect(profile.search?.provider).toBe("meilisearch");
    expect(profile.errorTracking?.provider).toBe("glitchtip");
    expect(profile.analytics?.provider).toBe("posthog");
    expect(profile.featureFlags?.provider).toBe("unleash");
  });

  it("has env var references for all concerns that need them", () => {
    const profile = ossFirstDefaults();
    expect(profile.db?.connectionStringEnvVar).toBe("DATABASE_URL");
    expect(profile.storage?.bucketEnvVar).toBe("S3_BUCKET");
    expect(profile.jobs?.redisUrlEnvVar).toBe("REDIS_URL");
    expect(profile.search?.apiKeyEnvVar).toBe("MEILI_KEY");
    expect(profile.errorTracking?.dsnEnvVar).toBe("GLITCHTIP_DSN");
    expect(profile.analytics?.apiKeyEnvVar).toBe("POSTHOG_KEY");
    expect(profile.featureFlags?.urlEnvVar).toBe("UNLEASH_URL");
  });
});

describe("inferRelevantConcerns", () => {
  it("returns auth and storage for a login + file upload prompt", () => {
    const concerns = inferRelevantConcerns("Build a landing page with login and file uploads");
    expect(concerns).toContain("auth");
    expect(concerns).toContain("storage");
  });

  it("returns minimal/empty for a simple blog post prompt", () => {
    const concerns = inferRelevantConcerns("Simple blog post");
    // No auth, storage, payments, jobs, email, search expected
    expect(concerns).not.toContain("auth");
    expect(concerns).not.toContain("storage");
    expect(concerns).not.toContain("payments");
    expect(concerns).not.toContain("jobs");
  });

  it("returns payments for a billing/subscription prompt", () => {
    const concerns = inferRelevantConcerns("SaaS dashboard with billing and subscription management");
    expect(concerns).toContain("payments");
  });

  it("returns auth for a prompt mentioning user accounts", () => {
    const concerns = inferRelevantConcerns("SaaS dashboard with login, billing, and user accounts");
    expect(concerns).toContain("payments");
    expect(concerns).toContain("auth");
  });

  it("returns jobs for a background worker prompt", () => {
    const concerns = inferRelevantConcerns("Email queue with background workers and cron jobs");
    expect(concerns).toContain("jobs");
    expect(concerns).toContain("email");
  });

  it("returns search for a search-heavy prompt", () => {
    const concerns = inferRelevantConcerns("Product catalog with full-text search and filter");
    expect(concerns).toContain("search");
  });

  it("returns empty array for a completely unrelated prompt", () => {
    const concerns = inferRelevantConcerns("A poem about the ocean");
    expect(concerns).toHaveLength(0);
  });
});
