import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API", () => {
  it("exports the canonical names", () => {
    for (const name of [
      "CANONICAL_ITEMS", "ChecklistItemSchema", "ChecklistResultSchema",
      "renderItemForPersona", "InMemoryCheckpointStore",
      "BootstrapEventSchema", "BootstrapCheckpoint"
    ]) {
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
