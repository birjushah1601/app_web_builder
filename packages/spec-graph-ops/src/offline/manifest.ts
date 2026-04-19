import { z } from "zod";

export const MANIFEST_SCHEMA_VERSION = 1 as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 hex chars");
const uuid = z.string().uuid();

const entry = z.object({
  name: z.string().min(1),
  sha256,
  bytes: z.number().int().nonnegative()
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  exportedAt: z.string().datetime(),
  projectId: uuid,
  tocoEntries: z.array(entry).nonempty(),
  archives: z.array(entry)
});

export type Manifest = z.infer<typeof manifestSchema>;

export function parseManifest(value: unknown): Manifest {
  return manifestSchema.parse(value);
}
