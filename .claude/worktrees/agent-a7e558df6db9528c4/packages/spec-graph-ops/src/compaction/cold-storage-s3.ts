import { createRequire } from "node:module";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ColdStorage } from "./cold-storage.js";

const require = createRequire(import.meta.url);

function parseS3Url(url: string): { bucket: string; prefix: string } {
  const match = /^s3:\/\/([^/]+)(?:\/(.*))?$/.exec(url);
  if (!match) throw new Error(`Invalid S3 URL: ${url}`);
  const bucket = match[1]!;
  const prefix = (match[2] ?? "").replace(/\/+$/, "");
  return { bucket, prefix };
}

export function createS3Storage(url: string): ColdStorage {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } =
    require("@aws-sdk/client-s3") as typeof import("@aws-sdk/client-s3");

  const client = new S3Client({});
  const { bucket, prefix } = parseS3Url(url);
  const fullKey = (key: string) => (prefix ? `${prefix}/${key}` : key);

  function archiveKey(projectId: string, fromEventId: bigint, toEventId: bigint): string {
    const pad = (n: bigint) => n.toString().padStart(20, "0");
    return `${projectId}/${pad(fromEventId)}-${pad(toEventId)}.jsonl.gz`;
  }

  return {
    async putArchive(input) {
      const key = archiveKey(input.projectId, input.fromEventId, input.toEventId);
      const compressed = gzipSync(Buffer.from(input.jsonl, "utf8"));
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: fullKey(key), Body: compressed }));
      return { key, bytes: compressed.byteLength };
    },
    async getArchive(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) }));
      const chunks: Buffer[] = [];
      const stream = result.Body as NodeJS.ReadableStream;
      for await (const c of stream) chunks.push(c as Buffer);
      return gunzipSync(Buffer.concat(chunks)).toString("utf8");
    },
    async deleteArchive(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(key) }));
    }
  };
}
