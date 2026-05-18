// Default DATABASE_URL_TEST so `pnpm -r test` works without per-shell
// env setup. Mirrors @atlas/spec-graph-data's pattern (which already does
// this) so behaviour is consistent across both Postgres-touching packages.
//
// If you want to point tests at a non-default Postgres, export
// DATABASE_URL_TEST in your shell — this setup only fills in the gap.

const DEFAULT_URL = "postgresql://atlas:atlas@localhost:5440/atlas_test";
if (!process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL_TEST = DEFAULT_URL;
}

export async function setup(): Promise<void> {}
export async function teardown(): Promise<void> {}
