---
name: assemble-brief-data-pipeline
description: Researcher fragment for data-pipeline artifact kind — ELT, ETL, dlt + dbt + DuckDB stacks, Modern Data Stack patterns
activate_on: visualize
model_hint: haiku
---

# Assemble Brief — Data Pipelines

Use this fragment when `designIntent.artifactKind === "data-pipeline"`. References are data-platform tools and Modern Data Stack patterns — NOT landing pages or generic backend APIs.

## Reference catalog (cite at least one per category)

### Connector / extraction patterns
- **Fivetran** (https://www.fivetran.com/connectors) — closed-source SaaS, but its connector catalog is the canonical reference for "what does a 'load Stripe data' pipeline look like". Cite the *shape* of the connector (incremental keys, retry semantics, schema evolution) — not the SaaS itself.
- **Airbyte** (https://docs.airbyte.com/integrations/) — open-source, runs anywhere. Connector specs are public; copy their patterns for source authentication + sync modes (full_refresh vs incremental_append vs incremental_dedup).
- **Singer** (https://www.singer.io) — older OSS spec. Reference if the user asks for a tap+target architecture specifically.
- **dlt** (https://dlthub.com/docs/) — Python-native, declarative. The `@dlt.resource` / `@dlt.source` pattern is what `atlas-dlt-python` ships. Cite the dlt verified-source examples (https://dlthub.com/docs/dlt-ecosystem/verified-sources) for source-shape — they're the closest match to what Atlas's developer role will write.

### Transformation patterns
- **dbt** (https://docs.getdbt.com) — de-facto standard for SQL transformations. Cite dbt's sources/refs/tests/snapshots/exposures concepts. Materialization choice (view vs table vs incremental) is load-bearing for the brief.
- **dbt project structure best practices** (https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview) — staging / intermediate / marts layering. Cite this when the user asks for "a real dbt project, not a toy".
- **sqlmesh** (https://sqlmesh.readthedocs.io) — newer alternative; reference only if the user explicitly mentions blue/green deploys or contracts.

### Destinations / warehouses
- **DuckDB** (https://duckdb.org/docs) — embedded analytical DB. Default destination for atlas-dlt-python. Cite for "I want a local-first warehouse with no creds" cases.
- **Snowflake / BigQuery / Postgres** — cite for the destination-swap path: dlt's `destination=` is one config line. Don't recommend Snowflake/BigQuery as default for Atlas projects (cred friction); offer them as the v2 path.

### Orchestration patterns
- **cron + a single Python script** — simplest. Cite for "I just want a daily job" briefs.
- **Airflow** (https://airflow.apache.org) — reference for "I have multiple pipelines with dependencies between them".
- **Dagster** (https://docs.dagster.io) — newer, asset-graph-first. Reference for "I want lineage built in".
- **Prefect** (https://docs.prefect.io) — Python-flow first. Reference for "I want decorators + retries without YAML".

### Modern Data Stack patterns
- **a16z's "Emerging Architectures for Modern Data Infrastructure"** — taxonomy reference: ingestion → storage → transformation → analytics → activation.
- **Locally Optimistic** (https://locallyoptimistic.com) — practitioner blog. Reference for team-shape + workflow patterns ("the small data warehouse", "ELT vs ETL", data contracts).
- **dataeng.dev** (https://dataeng.dev) — Modern Data Stack pattern catalog. Reference for "what does an end-to-end stack look like" briefs.
- **dbt Labs / Airbyte / Fivetran blogs** — pattern catalogs: incremental models, schema evolution, data contracts.

## Quality bar

- The brief names a **specific source** (Stripe, Postgres, S3 CSV, an HTTP API) — not "data".
- The brief names a **specific destination** (DuckDB by default; Snowflake/Postgres if the user pushes back).
- The brief names a **frequency** (one-shot, hourly, daily, on-demand). Default = daily for "background ETL" requests.
- The brief specifies **incremental vs full-refresh** semantics and the **incremental key** (timestamp column, sequence ID, etc.). Default = full-refresh for v1; incremental only when the source is large.
- The brief names at least **one transformation** — even if it's a passthrough view + one derived column. dbt without models is just storage.
- For multi-tenancy / PII briefs: explicit isolation strategy (tenant column + RLS, OR separate schemas, OR separate DuckDB files). Don't hand-wave.

## Anti-patterns

- Do NOT propose Spark / Flink / Beam clusters for atlas-dlt-python projects. The template is single-process Python; pretending otherwise is a lie.
- Do NOT recommend writing custom orchestration code in v1 — cron / `python -m pipelines.foo` is enough until the user explicitly asks for a DAG.
- Do NOT recommend Kafka / event-streaming sources without a clear case. dlt + cron handles 90% of "load X daily" briefs.
- Do NOT cite landing pages, generic SaaS marketing sites, or frontend tools. Stay in the data domain.
- Do NOT propose dbt without first declaring sources in `sources.yml`. "Just write a SQL file" without a source declaration is the #1 dbt onboarding pitfall.

## Brief template

```yaml
artifactKind: data-pipeline
sources:
  - name: <source_name>
    kind: <http_api | sql_database | s3_csv | webhook | static>
    auth: <none | api_key | oauth | basic>
    incremental_key: <timestamp_col | sequence_id | none>
destination:
  kind: duckdb       # default; swap to postgres/snowflake later
  path: /code/data/atlas.duckdb
transforms:
  - dbt_model: <model_name>
    materialized: <view | table | incremental>
    upstream: [<source_or_model>]
schedule:
  frequency: <one-shot | hourly | daily>
  cron: <if_explicit>
isolation:
  multi_tenant: <yes | no>
  strategy: <if_yes_specify>
```

## References cited in this skill

- Fivetran connector catalog (https://www.fivetran.com/connectors)
- Airbyte integrations docs (https://docs.airbyte.com/integrations/)
- dlt docs + verified-sources gallery (https://dlthub.com/docs/, https://dlthub.com/docs/dlt-ecosystem/verified-sources)
- dbt docs + best-practices structure guide (https://docs.getdbt.com)
- DuckDB docs (https://duckdb.org/docs)
- a16z modern data infrastructure taxonomy
- Locally Optimistic (https://locallyoptimistic.com)
- dataeng.dev — Modern Data Stack patterns (https://dataeng.dev)
