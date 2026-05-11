#!/usr/bin/env node
import("../dist/cli/compactor.cli.js").then((m) => m.main(process.argv));
