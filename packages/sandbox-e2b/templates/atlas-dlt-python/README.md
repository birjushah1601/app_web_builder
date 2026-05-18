# atlas-dlt-python E2B template

Python 3.12 + dlt 1.4+ + DuckDB 1.x + dbt-core 1.9+ + dbt-duckdb 1.9+ + pandas 2.x + pyarrow 18+ + FastAPI 0.115 + pytest + ruff via uv.

Used by Atlas's developer role when the architect's `canvasManifest.artifactKind === "data-pipeline"` AND `ATLAS_FF_MULTI_STACK=true` (Plan T.2.4).

## Why a FastAPI app in a data-pipeline template?

Data pipelines have no UI. The E2B preview iframe needs *something* served on port 3000 so users see signal that the pipeline is alive. This template bundles a tiny FastAPI status app that exposes:

- `GET /` — app metadata (name, version, stack)
- `GET /health` — `{"status": "ok", "stack": "dlt-python", "atlas": "sandbox-ready"}`
- `GET /runs?limit=20` — last N pipeline runs (read from DuckDB's `_dlt_loads` table)
- `GET /pipelines` — registered pipelines under the `pipelines/` package
- `GET /docs` — Swagger UI (FastAPI auto)

The status app is read-only against the DuckDB file at `/code/data/atlas.duckdb` (override via `ATLAS_DUCKDB_PATH`). The dlt pipelines write to that same file. dbt models read from it. Everything lives in a single `.duckdb` file inside `/code/data/`.

## Pre-installed runtime deps

- **dlt 1.4+** with `[duckdb]` extras — extract + load. Use `@dlt.resource`, `@dlt.source`, `dlt.pipeline(...).run(...)`.
- **duckdb 1.1+** — embedded analytical DB; default destination for dlt + read source for dbt.
- **dbt-core 1.9+** + **dbt-duckdb 1.9+** — transforms (T-side of ELT).
- **pandas 2.2+** + **pyarrow 18+** — data processing inside resources / ad-hoc analysis.
- **fastapi 0.115+** + **uvicorn[standard]** — status surface.
- **pydantic 2.x** — typed schemas + env config.
- **pytest** + **pytest-asyncio** — test framework.
- **ruff** — lint + format (line-length 100, py312, dbt artifacts excluded).
- **uv** — package manager + venv.

## Layout

```
/code/
  pyproject.toml                    # deps + tool config
  app/main.py                       # FastAPI status app (don't edit unless asked)
  pipelines/example_pipeline.py     # canonical dlt pipeline — copy this shape for new pipelines
  pipelines/<your-pipeline>.py      # add new pipelines here
  dbt_project/
    dbt_project.yml                 # adapter = dbt-duckdb, name + profile = atlas_dlt
    profiles.yml                    # local profile (NOT in $HOME/.dbt/) → /code/data/atlas.duckdb
    models/example_transform.sql    # canonical dbt model — copy this shape
    models/<your-model>.sql         # add new models here
    models/sources.yml              # source declarations + column docs + tests
  tests/test_main.py                # pytest smoke tests for the FastAPI status app
  data/atlas.duckdb                 # the warehouse (created by dlt at first run)
```

## Out-of-the-box endpoints

- `GET /` — app metadata
- `GET /health` — liveness
- `GET /runs?limit=20` — recent pipeline runs
- `GET /pipelines` — registered pipelines under `pipelines/`
- `GET /docs` — Swagger UI

## Local smoke test (no E2B credit)

```bash
cd packages/sandbox-e2b/templates/atlas-dlt-python
./scripts/smoke-test-local.sh
```

The script (1) builds the Docker image, (2) starts a container on :3000, (3) curls `/health` + `/runs` + `/pipelines`, (4) prints the responses, (5) cleans up.

## Build + push to E2B (republish)

```bash
cd packages/sandbox-e2b/templates/atlas-dlt-python
export E2B_API_KEY=e2b_...
./scripts/build-template.sh
# Capture the printed template ID; add it to e2b.toml's template_id; commit.
```

## Wire into atlas-web

When `ATLAS_FF_MULTI_STACK=true` AND architect classifies the project as `data-pipeline`, the sandbox factory routes provisioning to this template automatically (`apps/atlas-web/lib/sandbox/template-router.ts` → `case "data-pipeline": return "atlas-dlt-python"`). Per-project override via `ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-dlt-python` always wins.

## Common dev workflows

### Add a new dlt pipeline

```python
# pipelines/my_api.py
from typing import Iterator
import dlt

@dlt.resource(write_disposition="append")
def fetch_users() -> Iterator[dict]:
    import httpx
    resp = httpx.get("https://api.example.com/users")
    yield from resp.json()

if __name__ == "__main__":
    p = dlt.pipeline(
        pipeline_name="my_api",
        destination=dlt.destinations.duckdb("/code/data/atlas.duckdb"),
        dataset_name="atlas_dataset",
    )
    p.run(fetch_users())
```

Run: `uv run python -m pipelines.my_api`. Records appear in DuckDB at `atlas_dataset.fetch_users`.

### Add a new dbt model

```sql
-- dbt_project/models/users_summary.sql
{{ config(materialized='view') }}

SELECT
    date_trunc('day', loaded_at) AS day,
    count(*) AS n_users
FROM {{ source('raw', 'fetch_users') }}
GROUP BY 1
```

Declare the source in `dbt_project/models/sources.yml`, then run:

```bash
cd dbt_project && uv run dbt run --profiles-dir .
```

The model appears as a view in DuckDB.

### Query results manually

```bash
uv run duckdb /code/data/atlas.duckdb -c "SELECT * FROM atlas_dataset.example LIMIT 10"
```

## Notes

- The `app/main.py` file is intentionally short. The developer role typically does NOT modify it — pipelines + dbt models are the surface. Only edit `app/main.py` if the user explicitly asks for "a custom status endpoint at /foo".
- DuckDB is the *default* destination because it requires zero credentials. To switch to Postgres / Snowflake / BigQuery, only the `dlt.pipeline(destination=...)` line needs to change (and dbt-* adapter swap).
- dbt's `profiles.yml` is co-located with `dbt_project.yml` (NOT in `$HOME/.dbt/`) so commands work without env-var manipulation. Always pass `--profiles-dir .` when running dbt.
