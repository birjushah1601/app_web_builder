import { describe, expect, it } from "vitest";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { uniqueProjectId } from "./helpers.js";

const S3_URL = process.env.ATLAS_COLD_STORAGE_S3_URL;
const skip = !S3_URL;

describe.skipIf(skip)("cold-storage S3 adapter", () => {
  it("round-trips an archive through S3", async () => {
    const storage = createColdStorage({ kind: "s3", url: S3_URL! });
    const projectId = uniqueProjectId();
    const payload = "{\"a\":1}\n";

    const { key } = await storage.putArchive({
      projectId,
      fromEventId: 1n,
      toEventId: 1n,
      jsonl: payload
    });
    try {
      const result = await storage.getArchive(key);
      expect(result).toBe(payload);
    } finally {
      await storage.deleteArchive(key);
    }
  });
});
