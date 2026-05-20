#!/usr/bin/env node
// Runs pytest for packages/spec-graph-schema-py through the venv-resolved
// entrypoint so `pnpm py:test` works regardless of whether `uv` is on PATH.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePytest } from "./_python-bin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const pyPackage = join(repoRoot, "packages", "spec-graph-schema-py");

const { command, prefixArgs } = resolvePytest(pyPackage);
const extra = process.argv.slice(2);
const result = spawnSync(command, [...prefixArgs, ...extra], { cwd: pyPackage, stdio: "inherit" });
process.exit(result.status ?? 1);
