import { z } from "zod";

import { RendersEdgeSchema, type RendersEdge } from "./renders.js";
import { FetchesEdgeSchema, type FetchesEdge } from "./fetches.js";
import { ReadsEdgeSchema, type ReadsEdge } from "./reads.js";
import { MutatesEdgeSchema, type MutatesEdge } from "./mutates.js";
import { RequiresEdgeSchema, type RequiresEdge } from "./requires.js";
import { CoversEdgeSchema, type CoversEdge } from "./covers.js";
import { DependsOnEdgeSchema, type DependsOnEdge } from "./depends-on.js";
import { StyledByEdgeSchema, type StyledByEdge } from "./styled-by.js";
import { SubjectToEdgeSchema, type SubjectToEdge } from "./subject-to.js";
import { SupersedesEdgeSchema, type SupersedesEdge } from "./supersedes.js";
import { PowersEdgeSchema, type PowersEdge } from "./powers.js";
import { DisplaysEdgeSchema, type DisplaysEdge } from "./displays.js";
import { ManagesEdgeSchema, type ManagesEdge } from "./manages.js";

export const EDGE_TYPES = [
  "renders", "fetches", "reads", "mutates",
  "requires", "covers", "dependsOn",
  "styledBy", "subjectTo", "supersedes",
  "powers", "displays", "manages"
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const EdgeSchema = z.discriminatedUnion("type", [
  RendersEdgeSchema, FetchesEdgeSchema, ReadsEdgeSchema, MutatesEdgeSchema,
  RequiresEdgeSchema, CoversEdgeSchema, DependsOnEdgeSchema,
  StyledByEdgeSchema, SubjectToEdgeSchema, SupersedesEdgeSchema,
  PowersEdgeSchema, DisplaysEdgeSchema, ManagesEdgeSchema
]);

export type Edge =
  | RendersEdge | FetchesEdge | ReadsEdge | MutatesEdge
  | RequiresEdge | CoversEdge | DependsOnEdge
  | StyledByEdge | SubjectToEdge | SupersedesEdge
  | PowersEdge | DisplaysEdge | ManagesEdge;

export const edgeRegistry = {
  renders: RendersEdgeSchema,
  fetches: FetchesEdgeSchema,
  reads: ReadsEdgeSchema,
  mutates: MutatesEdgeSchema,
  requires: RequiresEdgeSchema,
  covers: CoversEdgeSchema,
  dependsOn: DependsOnEdgeSchema,
  styledBy: StyledByEdgeSchema,
  subjectTo: SubjectToEdgeSchema,
  supersedes: SupersedesEdgeSchema,
  powers: PowersEdgeSchema,
  displays: DisplaysEdgeSchema,
  manages: ManagesEdgeSchema
} as const satisfies Record<EdgeType, z.ZodTypeAny>;

export type EdgeRegistry = typeof edgeRegistry;
