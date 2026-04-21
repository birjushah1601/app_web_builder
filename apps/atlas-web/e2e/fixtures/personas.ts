// apps/atlas-web/e2e/fixtures/personas.ts
import path from "node:path";

export const PERSONA_STORAGE_STATE = {
  ama:   path.resolve("e2e/auth/ama.json"),
  diego: path.resolve("e2e/auth/diego.json"),
  priya: path.resolve("e2e/auth/priya.json"),
} as const;

export type Persona = keyof typeof PERSONA_STORAGE_STATE;
