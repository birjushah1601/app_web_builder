import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    // Default vitest timeout (5s) tips over under monorepo-wide parallel load
    // on Windows — many atlas-web tests pull in canvas-runtime + ritual-engine
    // (heavy module graphs with circular zod imports) which are slow to evaluate
    // when all 42 workspace packages are racing for CPU. The slowest cases
    // measured in isolation are ~2.5s; 15s gives enough headroom for contention
    // without masking actual hangs.
    testTimeout: 15_000,
    server: {
      deps: {
        // pg and next/server are Node-only; let Vite treat them as external
        // so vi.doMock() interceptions work cleanly in the test environment.
        external: [/^pg$/, /^next\//, /^iframe-resizer/]
      }
    }
  },
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname.replace(/\/$/, ""),
      // Plan S.4 — atlas-web consumes @atlas/canvas-runtime in CanvasShell
      // and renderers. The published package re-exports four files via
      // `export *`, two of which depend on `@atlas/ritual-engine` for zod
      // schemas. ritual-engine in turn imports from canvas-runtime to
      // compose RitualEventSchema — a circular module graph that Vite's
      // transformer can't safely initialise (zod sees half-loaded
      // discriminated-union members and crashes at import time).
      //
      // The shim here re-exports ONLY the side-effect-free pieces atlas-web
      // needs (CanvasModeRegistry, personaFilter + erased types). Production
      // (Next.js bundler) resolves the real package — the circular graph
      // is masked there because Webpack initialises each module exactly
      // once. This alias is vitest-only.
      "@atlas/canvas-runtime": new URL("./test/__aliases__/canvas-runtime.ts", import.meta.url).pathname
    }
  }
});
