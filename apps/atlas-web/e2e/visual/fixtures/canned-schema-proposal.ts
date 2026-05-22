// Deterministic SchemaProposal used by the schema-canvas visual fixture.
// Three directions: RESTful CRUD (recommended), RPC-style, Event-sourced.
// Entity richness drives the diego/priya persona density rendering.

import type { SchemaProposal } from "@atlas/role-schema-architect";

export const cannedSchemaProposal: SchemaProposal = {
  recommended: {
    id: "restful-crud",
    name: "RESTful CRUD",
    shortDescription: "Standard REST API with 4 core entities and full audit trail.",
    technicalDescription: "POST/GET/PATCH/DELETE over /users, /posts, /comments, /tags with FK integrity and RLS.",
    contract: {
      style: "rest",
      operations: [
        { method: "GET",    path: "/users",            summary: "List users",          statusCodes: [200] },
        { method: "POST",   path: "/users",            summary: "Create user",         statusCodes: [201, 422] },
        { method: "GET",    path: "/users/:id",        summary: "Get user",            statusCodes: [200, 404] },
        { method: "PATCH",  path: "/users/:id",        summary: "Update user",         statusCodes: [200, 404, 422] },
        { method: "DELETE", path: "/users/:id",        summary: "Delete user",         statusCodes: [204, 404] },
        { method: "GET",    path: "/posts",            summary: "List posts",          statusCodes: [200] },
        { method: "POST",   path: "/posts",            summary: "Create post",         statusCodes: [201, 422] },
        { method: "GET",    path: "/posts/:id",        summary: "Get post",            statusCodes: [200, 404] },
        { method: "PATCH",  path: "/posts/:id",        summary: "Update post",         statusCodes: [200, 404, 422] },
        { method: "DELETE", path: "/posts/:id",        summary: "Delete post",         statusCodes: [204, 404] },
        { method: "GET",    path: "/comments",         summary: "List comments",       statusCodes: [200] },
        { method: "POST",   path: "/comments",         summary: "Create comment",      statusCodes: [201, 422] },
        { method: "GET",    path: "/tags",             summary: "List tags",           statusCodes: [200] },
        { method: "POST",   path: "/tags",             summary: "Create tag",          statusCodes: [201, 422] }
      ]
    },
    dataModel: {
      entities: [
        {
          name: "user",
          description: "Registered application user with role-based access.",
          primaryKey: { columns: ["id"], strategy: "uuid" },
          fields: [
            { name: "id",         type: "uuid",        nullable: false, default: "gen_random_uuid()" },
            { name: "email",      type: "text",        nullable: false },
            { name: "role",       type: "text",        nullable: false, default: "'member'" },
            { name: "created_at", type: "timestamptz", nullable: false, default: "now()" },
            { name: "updated_at", type: "timestamptz", nullable: false, default: "now()" },
            { name: "deleted_at", type: "timestamptz", nullable: true }
          ],
          indexes: [
            { name: "user_email_uniq", columns: ["email"], unique: true },
            { name: "user_role_idx",   columns: ["role"] }
          ],
          constraints: [
            { type: "check", name: "user_role_valid", expression: "role IN ('admin','member','viewer')" }
          ],
          rls: {
            enabled: true,
            policies: [
              { name: "user_select_own", applyTo: "select", using: "id = auth.uid()" },
              { name: "user_admin_all",  applyTo: "all",    using: "auth.role() = 'admin'" }
            ]
          },
          audit: { createdAt: true, updatedAt: true, deletedAt: true },
          migrationHints: [
            "Add UNIQUE index on email before first deploy.",
            "Seed a default admin row in 001_seed.sql.",
            "Enable RLS before granting anon role SELECT."
          ]
        },
        {
          name: "post",
          description: "User-authored content item with tag associations.",
          primaryKey: { columns: ["id"], strategy: "uuid" },
          fields: [
            { name: "id",          type: "uuid",        nullable: false, default: "gen_random_uuid()" },
            { name: "author_id",   type: "uuid",        nullable: false, references: { entity: "user", field: "id", onDelete: "cascade" } },
            { name: "title",       type: "text",        nullable: false },
            { name: "body",        type: "text",        nullable: false },
            { name: "published",   type: "boolean",     nullable: false, default: "false" },
            { name: "created_at",  type: "timestamptz", nullable: false, default: "now()" },
            { name: "updated_at",  type: "timestamptz", nullable: false, default: "now()" }
          ],
          indexes: [
            { name: "post_author_idx",    columns: ["author_id"] },
            { name: "post_published_idx", columns: ["published", "created_at"] }
          ],
          constraints: [],
          rls: {
            enabled: true,
            policies: [
              { name: "post_select_published", applyTo: "select", using: "published = true OR author_id = auth.uid()" },
              { name: "post_insert_own",        applyTo: "insert", withCheck: "author_id = auth.uid()" }
            ]
          },
          audit: { createdAt: true, updatedAt: true },
          migrationHints: [
            "Consider GIN index on to_tsvector(body) for full-text search.",
            "Partial index WHERE published=true reduces planner cost on listing queries.",
            "Cascade delete removes all comments and tag associations automatically."
          ]
        },
        {
          name: "comment",
          description: "Threaded comment attached to a post.",
          primaryKey: { columns: ["id"], strategy: "uuid" },
          fields: [
            { name: "id",         type: "uuid",        nullable: false, default: "gen_random_uuid()" },
            { name: "post_id",    type: "uuid",        nullable: false, references: { entity: "post",    field: "id", onDelete: "cascade" } },
            { name: "author_id",  type: "uuid",        nullable: false, references: { entity: "user",    field: "id", onDelete: "cascade" } },
            { name: "body",       type: "text",        nullable: false },
            { name: "created_at", type: "timestamptz", nullable: false, default: "now()" }
          ],
          indexes: [
            { name: "comment_post_idx",   columns: ["post_id"] },
            { name: "comment_author_idx", columns: ["author_id"] }
          ],
          constraints: [],
          rls: {
            enabled: true,
            policies: [
              { name: "comment_select_open",  applyTo: "select",   using: "true" },
              { name: "comment_insert_own",   applyTo: "insert",   withCheck: "author_id = auth.uid()" },
              { name: "comment_delete_own",   applyTo: "delete",   using: "author_id = auth.uid()" }
            ]
          },
          audit: { createdAt: true, updatedAt: false },
          migrationHints: [
            "post_id index is critical — listing comments for a post is the hot path.",
            "Add CHECK(length(body) > 0) to reject blank submissions at DB level."
          ]
        },
        {
          name: "tag",
          description: "Flat label used to categorise posts.",
          primaryKey: { columns: ["id"], strategy: "uuid" },
          fields: [
            { name: "id",         type: "uuid", nullable: false, default: "gen_random_uuid()" },
            { name: "slug",       type: "text", nullable: false },
            { name: "label",      type: "text", nullable: false }
          ],
          indexes: [
            { name: "tag_slug_uniq", columns: ["slug"], unique: true }
          ],
          constraints: [],
          rls: { enabled: false, policies: [] },
          audit: { createdAt: false, updatedAt: false },
          migrationHints: [
            "Seed common tags in 002_tags.sql so UI dropdowns work from day one.",
            "Slug must be lowercase-kebab — add CHECK constraint."
          ]
        }
      ]
    }
  },
  alternates: [
    {
      id: "rpc-style",
      name: "RPC-style",
      shortDescription: "Procedure-oriented GraphQL — thin REST façade over named mutations.",
      technicalDescription: "GraphQL queries + mutations per use-case; no generic REST verbs.",
      contract: {
        style: "graphql",
        operations: [
          { kind: "query",    name: "listUsers",    summary: "Paginated user list",        args: [], returnType: "[User!]!" },
          { kind: "mutation", name: "createUser",   summary: "Register a new user",        args: [{ name: "email", type: "text", nullable: false }], returnType: "User!" },
          { kind: "query",    name: "listPosts",    summary: "Paginated published posts",  args: [], returnType: "[Post!]!" },
          { kind: "mutation", name: "publishPost",  summary: "Flip post to published",     args: [{ name: "id", type: "uuid", nullable: false }], returnType: "Post!" },
          { kind: "mutation", name: "addComment",   summary: "Append comment to post",     args: [{ name: "postId", type: "uuid", nullable: false }, { name: "body", type: "text", nullable: false }], returnType: "Comment!" },
          { kind: "query",    name: "listTags",     summary: "All available tags",         args: [], returnType: "[Tag!]!" }
        ]
      },
      dataModel: {
        entities: [
          {
            name: "user",
            description: "Registered user.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",    type: "uuid", nullable: false, default: "gen_random_uuid()" },
              { name: "email", type: "text", nullable: false },
              { name: "role",  type: "text", nullable: false, default: "'member'" }
            ],
            indexes: [{ name: "user_email_uniq", columns: ["email"], unique: true }],
            constraints: [],
            rls: { enabled: true, policies: [{ name: "user_own", applyTo: "select", using: "id = auth.uid()" }] },
            audit: { createdAt: true, updatedAt: true },
            migrationHints: ["Backfill role=admin for first user in migration 001."]
          },
          {
            name: "post",
            description: "Content item.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",        type: "uuid",    nullable: false, default: "gen_random_uuid()" },
              { name: "author_id", type: "uuid",    nullable: false, references: { entity: "user", field: "id", onDelete: "cascade" } },
              { name: "title",     type: "text",    nullable: false },
              { name: "body",      type: "text",    nullable: false },
              { name: "published", type: "boolean", nullable: false, default: "false" }
            ],
            indexes: [{ name: "post_author_idx", columns: ["author_id"] }],
            constraints: [],
            rls: { enabled: true, policies: [{ name: "post_published", applyTo: "select", using: "published = true" }] },
            audit: { createdAt: true, updatedAt: true },
            migrationHints: ["publishPost mutation sets published=true + updated_at=now()."]
          },
          {
            name: "comment",
            description: "Comment on a post.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",        type: "uuid", nullable: false, default: "gen_random_uuid()" },
              { name: "post_id",   type: "uuid", nullable: false, references: { entity: "post", field: "id", onDelete: "cascade" } },
              { name: "author_id", type: "uuid", nullable: false, references: { entity: "user", field: "id", onDelete: "cascade" } },
              { name: "body",      type: "text", nullable: false }
            ],
            indexes: [{ name: "comment_post_idx", columns: ["post_id"] }],
            constraints: [],
            rls: { enabled: false, policies: [] },
            audit: { createdAt: true, updatedAt: false },
            migrationHints: ["addComment resolver validates post.published=true before insert."]
          },
          {
            name: "tag",
            description: "Content label.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",   type: "uuid", nullable: false, default: "gen_random_uuid()" },
              { name: "slug", type: "text", nullable: false },
              { name: "label", type: "text", nullable: false }
            ],
            indexes: [{ name: "tag_slug_uniq", columns: ["slug"], unique: true }],
            constraints: [],
            rls: { enabled: false, policies: [] },
            audit: { createdAt: false, updatedAt: false },
            migrationHints: ["Seed 10 common tags in migration 002."]
          }
        ]
      }
    },
    {
      id: "event-sourced",
      name: "Event-sourced",
      shortDescription: "Append-only event log — read models rebuilt via projections.",
      technicalDescription: "domain_events table + JSONB payload; projections materialise user/post/comment views.",
      contract: {
        style: "rest",
        operations: [
          { method: "POST",  path: "/events",           summary: "Append domain event",        statusCodes: [201, 422] },
          { method: "GET",   path: "/projections/users", summary: "Materialised user view",     statusCodes: [200] },
          { method: "GET",   path: "/projections/posts", summary: "Materialised post view",     statusCodes: [200] },
          { method: "POST",  path: "/commands/publish-post",  summary: "Publish-post command",  statusCodes: [202, 422] },
          { method: "POST",  path: "/commands/add-comment",   summary: "Add-comment command",   statusCodes: [202, 422] }
        ]
      },
      dataModel: {
        entities: [
          {
            name: "user",
            description: "Projected user read-model.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",         type: "uuid",        nullable: false },
              { name: "email",      type: "text",        nullable: false },
              { name: "role",       type: "text",        nullable: false },
              { name: "updated_at", type: "timestamptz", nullable: false }
            ],
            indexes: [{ name: "user_email_idx", columns: ["email"], unique: true }],
            constraints: [],
            rls: { enabled: true, policies: [{ name: "user_own", applyTo: "select", using: "id = auth.uid()" }] },
            audit: { createdAt: true, updatedAt: true },
            migrationHints: [
              "Projection rebuilt by replaying UserRegistered + RoleChanged events.",
              "Truncate and replay is safe; add idempotency key to event log."
            ]
          },
          {
            name: "post",
            description: "Projected post read-model.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",          type: "uuid",        nullable: false },
              { name: "author_id",   type: "uuid",        nullable: false, references: { entity: "user", field: "id", onDelete: "cascade" } },
              { name: "title",       type: "text",        nullable: false },
              { name: "body",        type: "text",        nullable: false },
              { name: "published",   type: "boolean",     nullable: false },
              { name: "version",     type: "integer",     nullable: false, default: "0" },
              { name: "updated_at",  type: "timestamptz", nullable: false }
            ],
            indexes: [
              { name: "post_author_idx",    columns: ["author_id"] },
              { name: "post_version_idx",   columns: ["id", "version"], unique: true }
            ],
            constraints: [],
            rls: { enabled: true, policies: [{ name: "post_published", applyTo: "select", using: "published = true OR author_id = auth.uid()" }] },
            audit: { createdAt: true, updatedAt: true },
            migrationHints: [
              "Version field enables optimistic concurrency in command handlers.",
              "Projection must be idempotent — replay may re-deliver events."
            ]
          },
          {
            name: "comment",
            description: "Projected comment read-model.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",        type: "uuid",        nullable: false },
              { name: "post_id",   type: "uuid",        nullable: false, references: { entity: "post", field: "id", onDelete: "cascade" } },
              { name: "author_id", type: "uuid",        nullable: false, references: { entity: "user", field: "id", onDelete: "cascade" } },
              { name: "body",      type: "text",        nullable: false },
              { name: "created_at", type: "timestamptz", nullable: false }
            ],
            indexes: [{ name: "comment_post_idx", columns: ["post_id"] }],
            constraints: [],
            rls: { enabled: false, policies: [] },
            audit: { createdAt: true, updatedAt: false },
            migrationHints: ["CommentAdded event idempotency: deduplicate by event_id before insert."]
          },
          {
            name: "tag",
            description: "Tag read-model.",
            primaryKey: { columns: ["id"], strategy: "uuid" },
            fields: [
              { name: "id",    type: "uuid", nullable: false },
              { name: "slug",  type: "text", nullable: false },
              { name: "label", type: "text", nullable: false }
            ],
            indexes: [{ name: "tag_slug_uniq", columns: ["slug"], unique: true }],
            constraints: [],
            rls: { enabled: false, policies: [] },
            audit: { createdAt: false, updatedAt: false },
            migrationHints: ["Tags are immutable once created; no update event defined."]
          }
        ]
      }
    }
  ],
  reasoning:
    "RESTful CRUD is recommended for standard blog-style apps — well-understood, tooling-rich, and easy to onboard new contributors. RPC-style suits teams already invested in GraphQL. Event-sourced adds auditability at the cost of operational complexity."
};
