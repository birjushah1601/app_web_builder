import { GenericArtifactSchema } from "./generic.js";
import { ArtifactContractRegistry } from "./registry.js";

const KNOWN_VERSIONS = ["1"];

export function parseWorkflowArtifact(value: unknown, expectedKind: string): unknown {
  const schema = ArtifactContractRegistry.get(expectedKind) ?? GenericArtifactSchema;
  const parsed = schema.parse(value);
  const version = (parsed as { schemaVersion?: string }).schemaVersion;
  if (version && !KNOWN_VERSIONS.includes(version)) {
    throw new Error(`parseWorkflowArtifact: unknown schema version "${version}" for kind "${expectedKind}"`);
  }
  return parsed;
}
