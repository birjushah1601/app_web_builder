import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { createLogger } from "../logger.js";

export const ATTR_MARKER = "merge=atlas-spec-graph";
export const ATTR_LINES: Array<[pattern: string, line: string]> = [
  [".atlas/events.jsonl", ".atlas/events.jsonl     merge=atlas-spec-graph"],
  [".atlas/spec.graph.json", ".atlas/spec.graph.json  merge=atlas-spec-graph"]
];

export const GIT_CONFIG: Array<[key: string, value: string]> = [
  ["merge.atlas-spec-graph.name", "Atlas Spec Graph merge driver"],
  ["merge.atlas-spec-graph.driver", "npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P"],
  ["merge.atlas-spec-graph.recursive", "binary"]
];

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function patternAlreadyMapped(content: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+.*merge=atlas-spec-graph`,
    "m"
  );
  return regex.test(content);
}

export async function installDriver(repoRoot: string): Promise<void> {
  const log = createLogger();
  const attrPath = join(repoRoot, ".gitattributes");
  let content = await readOrEmpty(attrPath);

  for (const [pattern, line] of ATTR_LINES) {
    if (!patternAlreadyMapped(content, pattern)) {
      if (content.length > 0 && !content.endsWith("\n")) content += "\n";
      content += line + "\n";
    }
  }
  await writeFile(attrPath, content, "utf8");

  for (const [key, value] of GIT_CONFIG) {
    await execa("git", ["config", key, value], { cwd: repoRoot });
  }
  log.info("installDriver: registered atlas-spec-graph merge driver", { repoRoot });
}
