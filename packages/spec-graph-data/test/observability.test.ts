import { SpanKind } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { registry, traceApi } from "../src/observability.js";
import { SpecGraphRepo } from "../src/repo/spec-graph.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("observability: repo methods emit spans", () => {
  let db: Database;
  let repo: SpecGraphRepo;
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)]
    });
    // Use the trace API instance re-exported from observability.ts so the proxy
    // provider registered here is the SAME one our tracer is bound to. Vite can
    // otherwise load @opentelemetry/api twice (ESM + CJS variants), producing
    // two TraceAPI singletons with separate ProxyTracerProviders.
    traceApi.setGlobalTracerProvider(provider);
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    exporter.reset();
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("emits a span for SpecGraphRepo.create with the right name and attributes", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    const spans = exporter.getFinishedSpans();
    const createSpan = spans.find((s) => s.name === "SpecGraphRepo.create");
    expect(createSpan).toBeDefined();
    expect(createSpan!.kind).toBe(SpanKind.INTERNAL);
    expect(createSpan!.attributes["atlas.project_id"]).toBe(projectId);
    expect(createSpan!.status.code).toBe(0); // UNSET on success
  });
});

describe("observability: prometheus metrics", () => {
  let db: Database;
  let repo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    registry.resetMetrics();
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("increments the ops counter on every successful call", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/atlas_spec_graph_repo_ops_total\{operation="SpecGraphRepo\.create",status="ok"\} 1/);
  });

  it("records a duration observation", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/atlas_spec_graph_repo_op_duration_seconds_count\{operation="SpecGraphRepo\.create"\} 1/);
  });

  it("tracks error status on failure", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    await expect(repo.create(projectId, {})).rejects.toThrow();
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/atlas_spec_graph_repo_ops_total\{operation="SpecGraphRepo\.create",status="error"\} 1/);
  });
});
