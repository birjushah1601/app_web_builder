import type { z } from "zod";
import { GenericArtifactSchema } from "./generic.js";

type AnyArtifactSchema = z.ZodTypeAny;

class Registry {
  private map = new Map<string, AnyArtifactSchema>();
  register(kind: string, schema: AnyArtifactSchema): void {
    this.map.set(kind, schema);
  }
  get(kind: string): AnyArtifactSchema | undefined {
    return this.map.get(kind);
  }
  has(kind: string): boolean {
    return this.map.has(kind);
  }
}

export const ArtifactContractRegistry = new Registry();
export { GenericArtifactSchema };
export { parseWorkflowArtifact } from "./parse.js";
