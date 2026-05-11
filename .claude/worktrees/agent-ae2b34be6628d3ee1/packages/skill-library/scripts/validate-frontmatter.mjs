#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, validateFrontmatter } from "@atlas/skill-runtime";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const rootOverride = process.env.SKILL_LIBRARY_ROOT;
const libraryRoot = rootOverride ?? pkgRoot;
const skillsRoot = join(libraryRoot, "skills");

function collectMarkdown(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectMarkdown(full));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const files = collectMarkdown(skillsRoot);
if (files.length === 0) {
  process.stderr.write(`no .md files found under ${skillsRoot}\n`);
  process.exit(1);
}

const errors = [];
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  let body, fm;
  try {
    const parsed = parseFrontmatter(raw);
    body = parsed.body;
    fm = validateFrontmatter(parsed.frontmatter);
  } catch (err) {
    errors.push({ file, message: (err instanceof Error ? err.message : String(err)) });
    continue;
  }
  const rel = relative(libraryRoot, file);
  const segments = rel.split(sep);
  const isTestGenerator = segments.includes("test-generators");
  if (isTestGenerator && !fm.activate_on) {
    errors.push({ file, message: "test-generators must declare activate_on" });
  }
}

if (errors.length > 0) {
  for (const e of errors) {
    process.stderr.write(`FAIL ${e.file}: ${e.message}\n`);
  }
  process.exit(1);
}

process.stdout.write(`validated ${files.length} skills\n`);
