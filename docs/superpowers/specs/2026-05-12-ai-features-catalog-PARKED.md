# AI Features Catalog — Parked Design

**Status:** Parked 2026-05-12 — user is focusing on visual quality first. Revisit after the visuals spec ships.

## What we agreed

- **Catalog of 7 AI features**, each as an opt-in plugin attachable to a generated site at any time:
  1. 💬 Concierge Chat — floating widget, RAG over page content + owner docs
  2. 🔍 Semantic search box — embeddings on content, ranked results
  3. ✍️ Copy rewriter — in-place editor, "make it more playful / shorter / translate"
  4. 🖼️ AI image gen — beyond hero, any image slot
  5. 📋 Smart forms — auto-categorize inquiries, draft reply
  6. 🎙️ Voice tour — TTS landing narration (niche)
  7. 🎯 Personalized recommendations — short LLM quiz returning a pick
- Each feature is a separate flag (`ATLAS_FF_AI_FEATURE_<NAME>`) and a separate code template the Developer can scaffold.
- **Feature credentials**: BYO-key in V1 (owner supplies OpenAI / ElevenLabs / etc.).

## UX entry point (undecided — to confirm on revisit)

Three patterns shown to the user:
- **A. Sidebar toggle list** — dedicated "AI Features" panel in canvas right rail
- **B. Command palette (⌘K)** — search "add ..." → fuzzy-matches catalog
- **C. Recommended-first + ⌘K depth** — Architect pre-picks 2-3, "Browse all" leads to ⌘K (my lean)

## When we pick this up

Likely sequence:
1. Pick UX (probably C).
2. Define the feature manifest format (one TS file per feature with `{ name, scaffold(diff), credentials[], applicableTo[] }`).
3. Build the "feature install" ritual — when user toggles ON, fire a refine ritual that runs the scaffold's diff into the sandbox.
4. Build the recommendation surface — Architect reads `canvasManifest.artifactKind` and returns top-3 features from `applicableTo`.
5. Ship one feature end-to-end (suggest Concierge Chat — biggest demo wow) and validate the pattern.

## Out of scope when parked

- Vector DB selection (pgvector vs SQLite-vec vs cloud)
- Voice cloning details
- Multi-tenant credential vault
- Feature uninstall/cleanup semantics
