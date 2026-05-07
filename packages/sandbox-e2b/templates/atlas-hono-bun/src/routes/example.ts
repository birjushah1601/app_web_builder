import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

/**
 * Example feature router. NOT mounted by default — uncomment the
 * `app.route("/example", exampleRouter)` line in src/index.ts to enable.
 *
 * Demonstrates the pattern Atlas's developer role should use when adding
 * new features:
 *   1. Define a Hono router scoped to the feature.
 *   2. Use `@hono/zod-validator` for typed request bodies / queries / params.
 *   3. Return JSON via `c.json(...)`.
 *   4. Throw `HTTPException` (from `hono/http-exception`) for HTTP errors.
 */
const exampleRouter = new Hono();

const CreateItemSchema = z.object({
  name: z.string().min(1).max(120),
  quantity: z.number().int().min(0),
});

exampleRouter.get("/items", (c) =>
  c.json({ items: [] as Array<{ id: string; name: string; quantity: number }> })
);

exampleRouter.post(
  "/items",
  zValidator("json", CreateItemSchema),
  (c) => {
    const input = c.req.valid("json");
    return c.json(
      { id: crypto.randomUUID(), ...input },
      201
    );
  }
);

export default exampleRouter;
