"""FastAPI status app served on port 3000.

Data pipelines have no UI. This tiny status surface makes the E2B preview
iframe show SOMETHING — pipeline runs + registered pipelines. Read-only
against the DuckDB file at /code/data/atlas.duckdb (or the override path
provided via ATLAS_DUCKDB_PATH).
"""

from __future__ import annotations

import os
import pkgutil
from pathlib import Path
from typing import Any

import duckdb
from fastapi import FastAPI

DB_PATH = os.getenv("ATLAS_DUCKDB_PATH", "/code/data/atlas.duckdb")
DATASET_NAME = os.getenv("ATLAS_DUCKDB_DATASET", "atlas_dataset")

app = FastAPI(
    title="Atlas Data Pipeline",
    version="0.1.0",
    description="Status surface for an Atlas-generated data pipeline (dlt + DuckDB + dbt)",
)


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Atlas Data Pipeline", "version": "0.1.0", "stack": "dlt-python"}


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe — does NOT require the DuckDB file to exist."""
    return {"status": "ok", "stack": "dlt-python", "atlas": "sandbox-ready"}


@app.get("/runs")
def runs(limit: int = 20) -> dict[str, Any]:
    """List the last N pipeline runs from DuckDB's _dlt_loads table.

    Returns an empty list if the DuckDB file does not exist yet (pipeline
    hasn't run) or if the _dlt_loads table is missing.
    """
    if not Path(DB_PATH).exists():
        return {
            "runs": [],
            "db_path": DB_PATH,
            "note": "DuckDB file not yet created — run a pipeline first.",
        }
    try:
        with duckdb.connect(DB_PATH, read_only=True) as conn:
            rows = conn.execute(
                f"""
                SELECT load_id, schema_name, status, inserted_at
                FROM {DATASET_NAME}._dlt_loads
                ORDER BY inserted_at DESC
                LIMIT ?
                """,
                [limit],
            ).fetchall()
            return {
                "runs": [
                    {
                        "load_id": r[0],
                        "schema": r[1],
                        "status": r[2],
                        "inserted_at": str(r[3]),
                    }
                    for r in rows
                ],
                "db_path": DB_PATH,
            }
    except duckdb.Error:
        # _dlt_loads table not yet created (no pipeline has run successfully).
        return {
            "runs": [],
            "db_path": DB_PATH,
            "note": "_dlt_loads table not yet created.",
        }


@app.get("/pipelines")
def pipelines() -> dict[str, Any]:
    """List registered pipelines under the `pipelines/` package.

    Discovers every importable submodule of `pipelines` (skipping `__init__`)
    and returns its name. The frontend / curl can use this to know which
    pipelines are available to invoke.
    """
    try:
        import pipelines as pipelines_pkg
    except ImportError:
        return {"pipelines": [], "note": "pipelines package not importable from cwd."}

    discovered: list[dict[str, str]] = []
    pkg_path = getattr(pipelines_pkg, "__path__", None)
    if pkg_path:
        for module_info in pkgutil.iter_modules(pkg_path):
            if module_info.name.startswith("_"):
                continue
            discovered.append({"name": module_info.name, "module": f"pipelines.{module_info.name}"})

    return {"pipelines": discovered}
