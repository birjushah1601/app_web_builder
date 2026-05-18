"""Shared pytest fixtures for spec-graph-schema-py tests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_PACKAGES_DIR = Path(__file__).resolve().parent.parent.parent  # .../packages/
PY_PACKAGE_ROOT = REPO_PACKAGES_DIR / "spec-graph-schema-py"
TS_PACKAGE_ROOT = REPO_PACKAGES_DIR / "spec-graph-schema"
BUNDLED_SCHEMA_DIR = PY_PACKAGE_ROOT / "src" / "spec_graph_schema" / "schema"


@pytest.fixture(scope="session")
def ts_fixtures_dir() -> Path:
    return TS_PACKAGE_ROOT / "test" / "fixtures"


@pytest.fixture(scope="session")
def valid_forgot_password_graph(ts_fixtures_dir: Path) -> dict:
    path = ts_fixtures_dir / "valid-forgot-password.json"
    assert path.exists(), (
        f"TS fixture missing at {path}. "
        "Plan B.1 must be merged before these tests run."
    )
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundled_invariant_codes() -> list[str]:
    path = BUNDLED_SCHEMA_DIR / "invariant-codes.json"
    assert path.exists(), (
        f"Bundled artifact missing at {path}. "
        "Run `pnpm py:gen` first."
    )
    return json.loads(path.read_text(encoding="utf-8"))
