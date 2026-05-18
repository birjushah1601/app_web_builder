// Visual fixture route: deterministic "generated" restaurant landing page
// snapshot. In v1 this renders canned HTML (the editorial-dark direction
// applied to a hero + menu + reservation block). Future work: drive this
// from the real ritual pipeline against the deterministic mockLlm fixture
// so we exercise more of the stack.
export const dynamic = "force-dynamic";

export default function GeneratedRestaurantLanding() {
  return (
    <main
      data-testid="generated-restaurant-landing"
      className="min-h-screen bg-[#0a0a0a] text-white"
      style={{ fontFamily: "'IBM Plex Serif', Georgia, serif" }}
    >
      <section className="mx-auto max-w-5xl px-8 py-24">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-[#fbbf24]">
          Bandra · Fine Dining
        </p>
        <h1 className="mb-4 text-5xl font-semibold leading-tight">
          Atlas Kitchen
        </h1>
        <p
          className="mb-12 max-w-2xl text-base leading-relaxed text-slate-300"
          style={{ fontFamily: "Inter, system-ui, sans-serif" }}
        >
          A nine-course tasting menu rooted in seasonal Indian produce,
          served in an intimate twelve-seat room overlooking the bay.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded-md bg-[#fbbf24] px-5 py-3 text-sm font-semibold text-[#0a0a0a]"
            style={{ fontFamily: "Inter, system-ui, sans-serif" }}
          >
            Reserve a table
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-700 px-5 py-3 text-sm text-slate-200"
            style={{ fontFamily: "Inter, system-ui, sans-serif" }}
          >
            View menu
          </button>
        </div>
      </section>
      <section className="border-t border-slate-800">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-12 px-8 py-16 md:grid-cols-3">
          {[
            { kicker: "Hours", body: "Tue–Sun · 7pm – 11pm" },
            { kicker: "Address", body: "21 Pali Hill, Bandra West" },
            { kicker: "Contact", body: "+91 22 5555 1100" }
          ].map((b) => (
            <div key={b.kicker}>
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#fbbf24]">
                {b.kicker}
              </p>
              <p
                className="text-sm text-slate-200"
                style={{ fontFamily: "Inter, system-ui, sans-serif" }}
              >
                {b.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
