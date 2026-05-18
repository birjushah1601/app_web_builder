import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@atlas/role-researcher": path.resolve(__dirname, "src/index.ts")
    }
  }
});
