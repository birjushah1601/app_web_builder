"""Load the bundled JSON Schema artifact via importlib.resources.

The schema lives alongside this module in the `schema/` subpackage. It
is populated by tools/sync-schema-artifact.mjs (run via `pnpm py:gen`)
and MUST NOT be hand-edited.
"""
from __future__ import annotations

import json
from functools import lru_cache
from importlib.resources import files
from typing import Any


_SCHEMA_RESOURCE = "spec-graph.v1.schema.json"
_CODES_RESOURCE = "invariant-codes.json"


@lru_cache(maxsize=1)
def load_schema() -> dict[str, Any]:
    """Return the bundled JSON Schema 2020-12 document as a Python dict."""
    resource = files("spec_graph_schema.schema").joinpath(_SCHEMA_RESOURCE)
    with resource.open("rb") as f:
        return json.loads(f.read().decode("utf-8"))


@lru_cache(maxsize=1)
def load_invariant_codes() -> list[str]:
    """Return the bundled list of canonical invariant code strings."""
    resource = files("spec_graph_schema.schema").joinpath(_CODES_RESOURCE)
    with resource.open("rb") as f:
        return json.loads(f.read().decode("utf-8"))
