import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export interface PutArchiveInput {
  projectId: string;
  fromEventId: bigint;
  toEventId: bigint;
  jsonl: string;
}

export interface PutArchiveResult {
  key: string;
  bytes: number;
}

export interface ColdStorage {
  putArchive(input: PutArchiveInput): Promise<PutArchiveResult>;
  getArchive(key: string): Promise<string>;
  deleteArchive(key: string): Promise<void>;
}

export type ColdStorageConfig =
  | { kind: "fs"; dir: string }
  | { kind: "s3"; url: string };

function archiveKey(projectId: string, fromEventId: bigint, toEventId: bigint): string {
  const pad = (n: bigint) => n.toString().padStart(20, "0");
  return `${projectId}/${pad(fromEventId)}-${pad(toEventId)}.jsonl.gz`;
}

function createFsStorage(dir: string): ColdStorage {
  return {
    async putArchive(input) {
      const key = archiveKey(input.projectId, input.fromEventId, input.toEventId);
      const fullPath = join(dir, key);
      mkdirSync(dirname(fullPath), { recursive: true });
      const compressed = gzipSync(Buffer.from(input.jsonl, "utf8"));
      writeFileSync(fullPath, compressed);
      return { key, bytes: compressed.byteLength };
    },
    async getArchive(key) {
      return gunzipSync(readFileSync(join(dir, key))).toString("utf8");
    },
    async deleteArchive(key) {
      rmSync(join(dir, key), { force: true });
    }
  };
}

export function createColdStorage(config: ColdStorageConfig): ColdStorage {
  if (config.kind === "fs") return createFsStorage(config.dir);
  return createS3StorageLazy(config.url);
}

function createS3StorageLazy(url: string): ColdStorage {
  let inner: ColdStorage | null = null;
  async function load(): Promise<ColdStorage> {
    if (inner) return inner;
    const mod = await import("./cold-storage-s3.js");
    inner = mod.createS3Storage(url);
    return inner;
  }
  return {
    async putArchive(input) { return (await load()).putArchive(input); },
    async getArchive(key)   { return (await load()).getArchive(key); },
    async deleteArchive(k)  { return (await load()).deleteArchive(k); }
  };
}

export function coldStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ColdStorage {
  if (env.ATLAS_COLD_STORAGE_S3_URL) {
    return createColdStorage({ kind: "s3", url: env.ATLAS_COLD_STORAGE_S3_URL });
  }
  return createColdStorage({ kind: "fs", dir: env.ATLAS_COLD_STORAGE_DIR ?? "./atlas-cold-storage" });
}
