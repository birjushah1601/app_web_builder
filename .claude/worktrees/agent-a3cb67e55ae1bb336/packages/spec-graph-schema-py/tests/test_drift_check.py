"""The `pnpm py:check` command must catch drift in models.py.

This test is the teeth behind the drift-check contract: if a developer
edits Zod schemas without regenerating, pnpm py:check exits non-zero.

Test strategy: regenerate models.py (should be a no-op; exits 0), then
mutate the bundled schema JSON (to simulate a Zod schema change without
regenerating models.py), rerun py:check, assert exit code is non-zero,
restore.

Note: py:check works by running py:gen (which regenerates models.py from
the source schema) then comparing with git. This means hand-edits to
models.py are not detectable (py:gen overwrites them). The contract only
catches schema changes without regeneration — i.e., when the source schema
diverges from the committed models.py.

Windows note: pnpm is accessed via shell=True because pnpm.cmd is a Windows
.cmd shim and subprocess cannot find it with shell=False.
"""
from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # .../ai_builder
MODELS_PATH = (
    REPO_ROOT
    / "packages"
    / "spec-graph-schema-py"
    / "src"
    / "spec_graph_schema"
    / "models.py"
)
# The source-of-truth schema that py:gen reads. Mutating this simulates
# "developer updated Zod schema but did not regenerate."
SOURCE_SCHEMA_PATH = (
    REPO_ROOT
    / "packages"
    / "spec-graph-schema"
    / "dist"
    / "schema"
    / "spec-graph.v1.schema.json"
)


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    # shell=True required on Windows: pnpm is a .cmd shim not visible to shell=False
    return subprocess.run(
        cmd, cwd=REPO_ROOT, capture_output=True, text=True, shell=True
    )


def test_py_check_passes_when_models_are_in_sync() -> None:
    result = _run(["pnpm", "run", "py:check"])
    assert result.returncode == 0, (
        f"pnpm py:check failed unexpectedly:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


def test_py_check_fails_when_schema_has_diverged() -> None:
    """Simulate a Zod schema change without regeneration.

    py:check = py:gen + git diff --exit-code. py:gen reads the source schema
    and overwrites models.py. So we must mutate the *source schema* — not
    models.py — to produce a models.py that differs from what is committed.

    We use binary read/write for all file restores to preserve exact byte
    content (including line endings) and avoid SHA256 drift from CRLF/LF
    normalisation on Windows.
    """
    original_schema_bytes = SOURCE_SCHEMA_PATH.read_bytes()
    original_models_bytes = MODELS_PATH.read_bytes()
    try:
        # Inject a top-level description change that will appear in the
        # generated banner hash, causing git diff --exit-code to fail.
        mutated = original_schema_bytes.replace(
            b'"$schema"',
            b'"x-test-drift-marker": "intentional-drift-for-test", "$schema"',
            1,
        )
        SOURCE_SCHEMA_PATH.write_bytes(mutated)
        result = _run(["pnpm", "run", "py:check"])
        assert result.returncode != 0, (
            "pnpm py:check did NOT fail after mutating the source schema — drift is undetectable"
        )
    finally:
        # Always restore both files before the test harness sees them.
        # Binary write preserves line endings exactly to avoid hash skew.
        SOURCE_SCHEMA_PATH.write_bytes(original_schema_bytes)
        MODELS_PATH.write_bytes(original_models_bytes)

    # Sanity: after restore, py:check goes green again.
    result = _run(["pnpm", "run", "py:check"])
    assert result.returncode == 0, (
        f"py:check should pass again after restore:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
