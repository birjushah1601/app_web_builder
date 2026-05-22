import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { DesignIntent, InspirationBrief } from "@atlas/role-researcher";
import { SchemaArchitectFailedError } from "./errors.js";
import { SchemaProposalSchema, type SchemaProposal } from "./types.js";
import { generateMigrationHints } from "./migration-hints.js";

export const DESIGNER_PROPOSAL_MODEL = "claude-sonnet-4.5";

export const DRAFT_SYSTEM_PROMPT = `You are Atlas's Schema Architect.

Given a brief about what the user wants to build, emit ONE SchemaProposal containing exactly one recommended SchemaDirection and exactly two alternate SchemaDirections.

Each SchemaDirection MUST include:
- A short id (kebab-case, e.g. "rest-crud", "rpc-actions", "event-sourced", "normalized", "embedded").
- A human-readable name.
- A shortDescription (one sentence, jargon-free — for non-technical readers).
- A technicalDescription (one sentence, terse, names key choices — for builders).
- A complete contract (REST operations OR GraphQL operations, never mixed).
- A complete dataModel (one or more entities).

The 10 hard rules — every entity in every direction MUST comply:

1. PRIMARY KEYS. Every entity has a stable PK with explicit \`strategy\`. Default \`uuid\` + \`default: "gen_random_uuid()"\`. Use \`serial\` only with explicit justification in entity.notes.

2. FK ACTIONS. Every FK has an explicit \`onDelete\` ("cascade" / "set null" / "restrict" / "no action"). No defaults — the cardinality decision is part of the design.

3. FK INDEXES. Every FK column gets an entry in \`indexes\` unless explicitly suppressed in entity.notes. Index naming: \`<table>_<col>_idx\`.

4. CANONICAL POSTGRES TYPES.
   - \`text\` not \`varchar(N)\` (Postgres treats them the same; varchar adds friction).
   - \`timestamptz\` not \`timestamp\` (timezone-naive is a footgun).
   - \`citext\` for case-insensitive uniqueness (emails, usernames).
   - \`numeric\` with explicit precision for money; never \`decimal\` without precision.
   - \`jsonb\` not \`json\`; index with \`gin\` if queried.

5. MULTI-TENANCY. Any entity with a \`tenant_id\` (or analogous tenancy column) MUST set \`rls.enabled: true\` with a tenant-scoped \`using\` clause:
   \`tenant_id = current_setting('app.tenant_id')::uuid\`
   One RLS policy per verb (select/insert/update/delete).

6. AUDIT DEFAULTS. \`created_at\` + \`updated_at\` true on every entity by default. \`created_by\` true when tenancy is on. \`deleted_at\` (soft-delete) only when business requirement exists in the brief.

7. ENUMS. Prefer \`text\` + \`CHECK (col IN ('a','b','c'))\` constraint over \`CREATE TYPE foo_enum AS ENUM(...)\`. Postgres ENUM values cannot be removed without rewriting the type — disastrous for evolvability.

8. COMPOSITE INDEXES. Look for query patterns the brief implies (tenant-scoped list ordered by recency, status-filtered lists, etc.) and emit composite indexes: \`(tenant_id, created_at DESC)\`, \`(user_id, status, created_at)\`. Cover real access patterns; don't over-index.

9. MIGRATION SAFETY. You will NOT populate \`migrationHints\` — that field is deterministically generated post-emit. Return it as an empty array. But you SHOULD reflect best practice in the schema itself (don't propose schemas that need destructive migrations to fix obvious problems).

10. ARCHITECTURALLY DISTINCT DIRECTIONS. The 3 directions MUST be architecturally distinct, not cosmetic variants. Examples of valid distinction axes:
    - RESTful CRUD vs RPC-style operations vs Event-sourced commands.
    - Normalized vs Embedded (jsonb-heavy) vs Hybrid.
    - Synchronous vs Async-outbox vs CQRS-split.
    The \`recommended\` direction MUST cite WHY it's the best match in the proposal's \`reasoning\` field.

Call the emit_schema_proposal tool exactly once.`;

const FIELD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string" },
    nullable: { type: "boolean" },
    default: { type: "string" },
    references: {
      type: "object",
      properties: {
        entity: { type: "string" },
        field: { type: "string" },
        onDelete: { type: "string", enum: ["cascade", "set null", "restrict", "no action"] },
        onUpdate: { type: "string", enum: ["cascade", "set null", "restrict", "no action"] }
      },
      required: ["entity", "field", "onDelete"]
    },
    generated: { type: "object", properties: { as: { type: "string" }, stored: { type: "boolean" } }, required: ["as", "stored"] },
    description: { type: "string" }
  },
  required: ["name", "type", "nullable"]
} as const;

const INDEX_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    columns: { type: "array", items: { type: "string" }, minItems: 1 },
    unique: { type: "boolean" },
    where: { type: "string" },
    method: { type: "string", enum: ["btree", "gin", "gist", "hash"] }
  },
  required: ["name", "columns"]
} as const;

const ENTITY_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    fields: { type: "array", items: FIELD_SCHEMA, minItems: 1 },
    primaryKey: {
      type: "object",
      properties: {
        columns: { type: "array", items: { type: "string" }, minItems: 1 },
        strategy: { type: "string", enum: ["uuid", "serial", "composite"] }
      },
      required: ["columns", "strategy"]
    },
    indexes: { type: "array", items: INDEX_SCHEMA },
    constraints: { type: "array" },
    rls: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        policies: { type: "array" }
      },
      required: ["enabled", "policies"]
    },
    audit: {
      type: "object",
      properties: {
        createdAt: { type: "boolean" },
        updatedAt: { type: "boolean" },
        createdBy: { type: "boolean" },
        deletedAt: { type: "boolean" }
      },
      required: ["createdAt", "updatedAt"]
    },
    partitioning: {
      type: "object",
      properties: { kind: { type: "string", enum: ["range", "list", "hash"] }, on: { type: "string" } },
      required: ["kind", "on"]
    },
    migrationHints: { type: "array", items: { type: "string" } },
    notes: { type: "string" }
  },
  required: ["name", "description", "fields", "primaryKey", "indexes", "constraints", "rls", "audit", "migrationHints"]
} as const;

const DIRECTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    shortDescription: { type: "string" },
    technicalDescription: { type: "string" },
    contract: { type: "object" },
    dataModel: {
      type: "object",
      properties: { entities: { type: "array", items: ENTITY_SCHEMA, minItems: 1 } },
      required: ["entities"]
    }
  },
  required: ["id", "name", "shortDescription", "technicalDescription", "contract", "dataModel"]
} as const;

export const PROPOSAL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    recommended: DIRECTION_SCHEMA,
    alternates: { type: "array", items: DIRECTION_SCHEMA, minItems: 2, maxItems: 2 },
    reasoning: { type: "string" }
  },
  required: ["recommended", "alternates", "reasoning"]
} as const;

export interface AssembleProposalInput {
  llm: LLMProvider;
  designIntent: DesignIntent;
  brief: InspirationBrief | null;
  architectArtifact: unknown;
  model?: string;
}

export async function assembleProposal(input: AssembleProposalInput): Promise<SchemaProposal> {
  const userTurn = renderUserTurn(input.designIntent, input.brief, input.architectArtifact);

  const messages: LLMMessage[] = [
    { role: "system", content: DRAFT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "user", content: userTurn }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: input.model ?? process.env.ATLAS_LLM_SCHEMA_ARCHITECT_MODEL ?? DESIGNER_PROPOSAL_MODEL,
      maxTokens: 8192,
      tools: [{ name: "emit_schema_proposal", description: "Emit schema proposal", input_schema: PROPOSAL_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_schema_proposal" }
    });
  } catch (err) {
    throw new SchemaArchitectFailedError(`schema-architect failed [llm-error]: ${(err as Error).message}`, { reason: "llm-error", cause: err });
  }

  const parsed = SchemaProposalSchema.safeParse(result.input);
  if (!parsed.success) {
    const reason: "broken-reference" | "duplicate-name" | "schema-mismatch" = parsed.error.message.includes("broken-reference")
      ? "broken-reference"
      : parsed.error.message.includes("duplicate-name")
        ? "duplicate-name"
        : "schema-mismatch";
    throw new SchemaArchitectFailedError(`schema-architect failed [${reason}]: ${parsed.error.message}`, {
      reason,
      cause: parsed.error
    });
  }

  // Populate migrationHints deterministically across all entities in all 3 directions.
  for (const direction of [parsed.data.recommended, ...parsed.data.alternates]) {
    for (const entity of direction.dataModel.entities) {
      entity.migrationHints = generateMigrationHints(entity);
    }
  }

  return parsed.data;
}

function renderUserTurn(designIntent: DesignIntent, brief: InspirationBrief | null, architectArtifact: unknown): string {
  return `## Brief
${JSON.stringify(brief ?? {}, null, 2)}

## Design intent
${JSON.stringify(designIntent ?? {}, null, 2)}

## Architect artifact (artifactKind, deep plan summary)
${JSON.stringify(architectArtifact ?? {}, null, 2)}

Emit one SchemaProposal with 3 architecturally distinct directions. Follow the 10 hard rules in the system prompt.`;
}
