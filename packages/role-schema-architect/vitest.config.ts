import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      zod: path.resolve("/C/Users/birju/.config/opencode/node_modules/zod/v3/index.js")
    }
  },
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
