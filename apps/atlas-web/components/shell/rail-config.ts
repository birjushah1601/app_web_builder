/**
 * RAIL_SHELL_CONFIG — single source of truth for the persistent left-rail's
 * layout dimensions. Plan G v1 ships a fixed 360px wide rail; the constant
 * lives in its own file so Plan G v2 (resize + collapse) can swap the
 * export for a hook (`useRailShellConfig()`) backed by a context provider
 * without rewriting `RailShell.tsx` itself.
 *
 * v1 contract (frozen by Object.freeze):
 *   { widthPx: 360 }
 *
 * v2 contract (NOT shipped here — documented for future maintainers):
 *   - export removed; replaced by `useRailShellConfig(): RailShellConfig`
 *   - RailShellConfig may grow `collapsed: boolean` and `userPreferredWidthPx: number`
 *   - <RailShellConfigProvider /> wraps the layout and persists user prefs to localStorage
 *
 * The Plan G v1 → v2 migration changes exactly two lines in RailShell.tsx:
 *   - `import { RAIL_SHELL_CONFIG } from "./rail-config"` →
 *     `import { useRailShellConfig } from "./rail-config"`
 *   - `const cfg = RAIL_SHELL_CONFIG` →
 *     `const cfg = useRailShellConfig()`
 *
 * Every consumer below those two lines is unchanged. This is the contract.
 */

export interface RailShellConfig {
  /** Pixel width of the rail, applied as inline style + a data attribute
   *  for test-friendly DOM querying. v1 fixed at 360. */
  readonly widthPx: number;
}

export const RAIL_SHELL_CONFIG: RailShellConfig = Object.freeze({
  widthPx: 360
});
