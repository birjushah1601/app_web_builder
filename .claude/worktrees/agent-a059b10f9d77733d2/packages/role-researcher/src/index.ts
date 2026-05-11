export {
  InspirationBriefSchema,
  DesignIntentSchema,
  ReferenceSchema,
  type InspirationBrief,
  type DesignIntent,
  type Reference
} from "./types.js";

export { ResearcherRole, type ResearcherRoleOptions } from "./role.js";

export { BraveSearchAdapter, type WebFetchAdapter, type WebHit, type BraveSearchAdapterOptions } from "./web-fetch.js";

export { loadCatalog, lookupCategory, type CatalogEntry, type CatalogReference } from "./local-catalog.js";

export { assembleBrief, RESEARCHER_BRIEF_MODEL } from "./assemble-brief.js";

export { ResearcherFailedError, CatalogParseError, WebFetchError } from "./errors.js";
