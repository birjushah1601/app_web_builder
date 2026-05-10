import { createYoga } from "graphql-yoga";
import { schema } from "./schema/index.js";

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  // GraphiQL on by default in dev. To disable, pass `graphiql: false`.
  graphiql: { title: "atlas-graphql-yoga" },
  // Yoga handles CORS itself; relax for local dev.
  cors: { origin: "*", credentials: false },
  context: ({ request }) => ({ request })
});

export interface CreateServerOptions {
  port?: number;
  hostname?: string;
}

export function createServer(opts: CreateServerOptions = {}) {
  // Default port 3001 (NOT 3000) — the e2bdev/code-interpreter base image
  // already binds :3000, so Bun.serve EADDRINUSEs on 3000.
  const port = opts.port ?? Number(process.env.PORT ?? 3001);
  const hostname = opts.hostname ?? "0.0.0.0";

  return Bun.serve({
    port,
    hostname,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({
          status: "ok",
          stack: "graphql-yoga",
          atlas: "sandbox-ready"
        });
      }

      if (request.method === "GET" && url.pathname === "/") {
        return Response.json({
          name: "Atlas Sandbox",
          version: "0.1.0",
          graphqlEndpoint: "/graphql"
        });
      }

      // Yoga handles /graphql (POST queries + GET GraphiQL).
      return yoga.fetch(request);
    }
  });
}

// Boot when invoked directly (Bun.main pattern).
if (import.meta.main) {
  const server = createServer();
  console.log(
    `atlas-graphql-yoga ready on http://${server.hostname}:${server.port} ` +
      `(GraphQL @ /graphql, GraphiQL @ /graphql)`
  );
}
