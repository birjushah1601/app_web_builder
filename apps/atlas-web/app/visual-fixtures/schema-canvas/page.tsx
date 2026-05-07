// Visual fixture route: schema-canvas-v1 (tenants + RLS view).
//
// The dedicated <SchemaCanvas> renderer is not yet shipped (Plan S.4
// scope). This fixture renders a deterministic placeholder so visual
// snapshots exist for the slot — when the real renderer lands the spec
// baselines will need a one-time regeneration.
export const dynamic = "force-dynamic";

const TABLES = [
  { name: "tenants", columns: ["id", "name", "owner_user_id", "created_at"] },
  { name: "users", columns: ["id", "tenant_id", "email", "role"] },
  { name: "rls_policies", columns: ["id", "table_name", "policy_name", "expression"] }
];

export default function SchemaCanvasFixture() {
  return (
    <main
      data-testid="schema-canvas"
      className="min-h-screen bg-slate-50 p-8"
    >
      <h1 className="mb-6 text-xl font-semibold text-slate-900">
        Schema · tenants + RLS
      </h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {TABLES.map((t) => (
          <div
            key={t.name}
            data-testid={`schema-table-${t.name}`}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="mb-3 font-mono text-sm font-semibold text-slate-900">
              {t.name}
            </div>
            <ul className="space-y-1">
              {t.columns.map((c) => (
                <li
                  key={c}
                  className="font-mono text-xs text-slate-600"
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
