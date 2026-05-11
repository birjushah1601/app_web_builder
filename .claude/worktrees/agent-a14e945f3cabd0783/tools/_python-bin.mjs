// Resolve Python tool entrypoints for the spec-graph-schema-py package without
// depending on `uv` being on PATH. Many Windows installs land uv in
// %USERPROFILE%\.local\bin\ but never add it to PATH; meanwhile `uv sync`
// always materializes the venv at <pyPackage>/.venv/, and the venv's Scripts/
// (or bin/) directory contains the exact pinned `datamodel-codegen` and
// `pytest` binaries we want. Prefer the venv directly; fall back to `uv run`
// only when the venv is absent.

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const isWindows = platform() === "win32";
const VENV_BIN_DIR = isWindows ? "Scripts" : "bin";
const EXE_SUFFIX = isWindows ? ".exe" : "";

function venvBin(pyPackage, name) {
  return join(pyPackage, ".venv", VENV_BIN_DIR, `${name}${EXE_SUFFIX}`);
}

function resolveUv() {
  const candidates = [
    process.env.UV_BIN,
    isWindows ? join(homedir(), ".local", "bin", "uv.exe") : join(homedir(), ".local", "bin", "uv"),
    "uv"
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === "uv") return "uv"; // last-resort: trust PATH
    if (existsSync(c)) return c;
  }
  return null;
}

function resolveVenv(pyPackage, name) {
  const direct = venvBin(pyPackage, name);
  if (existsSync(direct)) return { command: direct, prefixArgs: [] };
  const uv = resolveUv();
  if (!uv) {
    throw new Error(
      `Cannot resolve '${name}': no venv at ${direct} and 'uv' not found.\n` +
        `  Fix: cd ${pyPackage} && uv sync\n` +
        `  Or: install uv (https://docs.astral.sh/uv/) and add ~/.local/bin to PATH.`
    );
  }
  return { command: uv, prefixArgs: ["run", name] };
}

export function resolveDatamodelCodegen(pyPackage) {
  return resolveVenv(pyPackage, "datamodel-codegen");
}

export function resolvePytest(pyPackage) {
  return resolveVenv(pyPackage, "pytest");
}
