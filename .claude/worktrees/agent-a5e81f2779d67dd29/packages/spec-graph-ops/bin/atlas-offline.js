#!/usr/bin/env node
import("../dist/cli/offline.cli.js").then((m) => m.main(process.argv));
