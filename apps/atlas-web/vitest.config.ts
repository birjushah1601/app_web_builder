import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // pg and next/server are Node-only; let Vite treat them as external
        // so vi.doMock() interceptions work cleanly in the test environment.
        external: [/^pg$/, /^next\//, /^iframe-resizer/]
      }
    }
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname.replace(/\/$/, "") }
  }
});
