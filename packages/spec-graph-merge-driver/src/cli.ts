import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { UnknownPatternError, dispatchMerge, patternFor } from "./merge/dispatcher.js";
import { installDriver } from "./install/install.js";
import { uninstallDriver } from "./install/uninstall.js";
import { createLogger } from "./logger.js";
import { withMergeSpan } from "./observability.js";

export async function runMerge(
  basePath: string,
  oursPath: string,
  theirsPath: string,
  pathname: string
): Promise<number> {
  const log = createLogger();
  const pattern = patternFor(pathname);
  try {
    return await withMergeSpan({ pattern, path: pathname }, async () => {
      const [base, ours, theirs] = await Promise.all([
        readFile(basePath, "utf8").catch(() => ""),
        readFile(oursPath, "utf8"),
        readFile(theirsPath, "utf8")
      ]);
      const merged = await dispatchMerge({
        pathname,
        base,
        ours,
        theirs,
        databaseUrl: process.env.ATLAS_DATABASE_URL
      });
      await writeFile(oursPath, merged, "utf8");
      log.info("merge-driver: merged cleanly", { pathname, pattern });
      return 0;
    });
  } catch (err) {
    if (err instanceof UnknownPatternError) {
      log.error("merge-driver: unknown pattern, refusing to merge", { pathname });
      return 2;
    }
    log.error("merge-driver: I/O error during merge", {
      pathname,
      err: (err as Error).message
    });
    return 1;
  }
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("atlas-merge-driver").description("Atlas Spec Graph Git merge driver");

  program
    .command("merge <base> <ours> <theirs> <pathname>")
    .description("Invoked by Git: merges base/ours/theirs for the given pathname, writing result to ours.")
    .action(async (base: string, ours: string, theirs: string, pathname: string) => {
      const code = await runMerge(base, ours, theirs, pathname);
      process.exit(code);
    });

  program
    .command("install")
    .description("Register the driver in the current repo (.gitattributes + git config).")
    .action(async () => {
      await installDriver(process.cwd());
      process.exit(0);
    });

  program
    .command("uninstall")
    .description("Reverse a previous install in the current repo.")
    .action(async () => {
      await uninstallDriver(process.cwd());
      process.exit(0);
    });

  await program.parseAsync(argv);
}
