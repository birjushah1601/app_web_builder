"""Guard against hand-edits to the generated models.py."""
from __future__ import annotations

from pathlib import Path

MODELS_PATH = (
    Path(__file__).resolve().parent.parent
    / "src"
    / "spec_graph_schema"
    / "models.py"
)
BANNER_LINE_ONE = "# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT"


def test_models_file_exists() -> None:
    assert MODELS_PATH.exists(), (
        f"{MODELS_PATH} missing. Run `pnpm py:gen` from the repo root."
    )


def test_banner_on_line_one() -> None:
    lines = MODELS_PATH.read_text(encoding="utf-8").splitlines()
    assert lines[0] == BANNER_LINE_ONE
    assert lines[1].startswith("# Source:")
    assert lines[2].startswith("# Regenerate:")
    assert lines[3].startswith("# Schema hash: sha256:")


def test_banner_hash_format() -> None:
    import re
    line = MODELS_PATH.read_text(encoding="utf-8").splitlines()[3]
    assert re.match(r"^# Schema hash: sha256:[0-9a-f]{64}$", line)
