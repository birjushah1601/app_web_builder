/**
 * Pothos SchemaBuilder for atlas-graphql-yoga.
 *
 * v1 of the template ships the Drizzle plugin imported but no DB connection
 * wired (the template doesn't ship a Postgres/SQLite driver). When the
 * developer's diff adds a real DB, they enable the plugin by passing
 * `drizzle: { client: db, schema }` here. Until then the schema only has
 * scalar fields.
 */
import SchemaBuilder from "@pothos/core";

// Note: PothosTypes is the type-bag pattern — extending the interface below
// gives all resolvers strong typing for context, scalars, and the DB schema.
export interface AtlasPothosTypes {
  Context: { request: Request };
  Scalars: {
    ID: { Input: string; Output: string };
    String: { Input: string; Output: string };
    Boolean: { Input: boolean; Output: boolean };
    Int: { Input: number; Output: number };
    Float: { Input: number; Output: number };
  };
}

export const builder = new SchemaBuilder<AtlasPothosTypes>({
  // Plugins go here when the developer adds a DB:
  //   plugins: [DrizzlePlugin],
  //   drizzle: { client: db, schema }
});
