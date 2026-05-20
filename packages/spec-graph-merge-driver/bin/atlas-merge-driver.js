#!/usr/bin/env node
import { main } from "../dist/cli.js";

main(process.argv).catch((err) => {
  process.stderr.write(
    JSON.stringify({ level: "fatal", msg: "atlas-merge-driver crashed", err: String(err?.stack ?? err) }) + "\n"
  );
  process.exit(3);
});
