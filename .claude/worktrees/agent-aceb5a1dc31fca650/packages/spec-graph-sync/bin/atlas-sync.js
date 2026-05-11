#!/usr/bin/env node
import("../dist/cli.js").then((m) => m.main()).catch((err) => {
  process.stderr.write(`[atlas-sync] fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
