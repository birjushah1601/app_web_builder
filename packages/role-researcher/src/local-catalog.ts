import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { CatalogParseError } from "./errors.js";

const CatalogReferenceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  why: z.string().min(1),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).optional(),
  typography: z
    .object({
      primary: z.string().min(1),
      secondary: z.string().min(1).optional()
    })
    .optional(),
  density: z.enum(["compact", "comfortable", "spacious"]).optional(),
  notes: z.string().optional()
});

const CatalogEntrySchema = z.object({
  category: z.string().min(1),
  synonyms: z.array(z.string()).default([]),
  references: z.array(CatalogReferenceSchema).min(1),
  patternsThatWin: z.array(z.string()).default([]),
  patternsThatLose: z.array(z.string()).default([])
});

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogReference = z.infer<typeof CatalogReferenceSchema>;

export async function loadCatalog(dir: string): Promise<Map<string, CatalogEntry>> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml"));
  const map = new Map<string, CatalogEntry>();
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), "utf8");
    let parsed: unknown;
    try {
      // js-yaml v4 uses safe schema by default; SAFE_SCHEMA was removed.
      parsed = yaml.load(raw);
    } catch (err) {
      throw new CatalogParseError(`yaml parse failed: ${(err as Error).message}`, { file });
    }
    const entry = CatalogEntrySchema.safeParse(parsed);
    if (!entry.success) {
      throw new CatalogParseError(`schema validation failed: ${entry.error.message}`, { file });
    }
    map.set(entry.data.category.toLowerCase(), entry.data);
  }
  return map;
}

export function lookupCategory(catalog: Map<string, CatalogEntry>, key: string): CatalogEntry | undefined {
  const normalized = key.toLowerCase();
  const direct = catalog.get(normalized);
  if (direct) return direct;
  for (const entry of catalog.values()) {
    if (entry.synonyms.map((s) => s.toLowerCase()).includes(normalized)) return entry;
  }
  return undefined;
}
