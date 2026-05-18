"""Canonical dlt example pipeline.

Demonstrates the @dlt.resource / @dlt.source / pipeline.run() pattern that
the developer role mimics when writing the user's data-pipeline diff.

Loads a small static record set into a DuckDB destination at
/code/data/atlas.duckdb (or the override passed to run_pipeline).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import dlt
from dlt.common.pipeline import LoadInfo

DEFAULT_DB_PATH = os.getenv("ATLAS_DUCKDB_PATH", "/code/data/atlas.duckdb")
DEFAULT_DATASET = os.getenv("ATLAS_DUCKDB_DATASET", "atlas_dataset")


@dlt.resource(name="example", write_disposition="replace")
def example_source() -> Iterator[dict]:
    """A trivial dlt resource that yields hard-coded records.

    Replace this with a real source (HTTP API, SQL DB, S3 CSV, ...) by
    replacing the body — the @dlt.resource contract is just "yield dicts".
    """
    yield {"id": 1, "value": "alpha", "loaded_at": "2026-05-07T00:00:00Z"}
    yield {"id": 2, "value": "beta", "loaded_at": "2026-05-07T00:00:00Z"}
    yield {"id": 3, "value": "gamma", "loaded_at": "2026-05-07T00:00:00Z"}


def run_pipeline(db_path: str = DEFAULT_DB_PATH, dataset_name: str = DEFAULT_DATASET) -> LoadInfo:
    """Run the example pipeline → DuckDB.

    Args:
        db_path: Path to the DuckDB file. Defaults to /code/data/atlas.duckdb
                 so the status app finds it at the path declared in
                 dbt_project/profiles.yml.
        dataset_name: dlt dataset (DuckDB schema) name.

    Returns:
        LoadInfo from dlt — useful for the status app's /runs endpoint.
    """
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    pipeline = dlt.pipeline(
        pipeline_name="atlas_example",
        destination=dlt.destinations.duckdb(db_path),
        dataset_name=dataset_name,
    )
    return pipeline.run(example_source())


if __name__ == "__main__":
    info = run_pipeline()
    print(info)
