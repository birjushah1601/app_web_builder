import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { ATTR_LINES, GIT_CONFIG } from "./install.js";
import { createLogger } from "../logger.js";

export async function uninstallDriver(repoRoot: string): Promise<void> {
  const log = createLogger();
  const attrPath = join(repoRoot, ".gitattributes");

  let content = "";
  try {
    content = await readFile(attrPath, "utf8");
  } catch {
    content = "";
  }

  if (content.length > 0) {
    const removed = content
      .split("\n")
      .filter((line) => {
        for (const [pattern] of ATTR_LINES) {
          if (line.startsWith(pattern) && line.includes("merge=atlas-spec-graph")) return false;
        }
        return true;
      })
      .join("\n");
    const cleaned = removed.replace(/\n+$/g, "");
    if (cleaned.trim() === "") {
      await unlink(attrPath).catch(() => {
        /* swallow */
      });
    } else {
      await writeFile(attrPath, cleaned + "\n", "utf8");
    }
  }

  for (const [key] of GIT_CONFIG) {
    await execa("git", ["config", "--unset-all", key], { cwd: repoRoot, reject: false });
  }
  log.info("uninstallDriver: removed atlas-spec-graph merge driver", { repoRoot });
}
