import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

export async function createTmpRepo(prefix = "atlas-repo-"): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  await execa("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@atlas.local"], { cwd: dir });
  await execa("git", ["config", "user.name", "Atlas Test"], { cwd: dir });
  return dir;
}

export async function gitConfigGet(repo: string, key: string): Promise<string | undefined> {
  const { stdout, exitCode } = await execa("git", ["config", "--get", key], {
    cwd: repo,
    reject: false
  });
  return exitCode === 0 ? stdout : undefined;
}

export function readFileOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
