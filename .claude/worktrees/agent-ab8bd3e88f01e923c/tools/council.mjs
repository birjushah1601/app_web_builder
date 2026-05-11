// Atlas Spec Graph v1 — LLM Council Review
// Karpathy-style three-stage consensus protocol via OpenRouter.
// Stage 1: independent critiques from 4 frontier models (parallel)
// Stage 2: anonymized peer review by all 4 models (parallel)
// Stage 3: Chairman synthesis by Claude Opus 4.7
// Output: docs/council-review/2026-04-18-spec-graph-v1-pass1.md
//
// No external deps. Node 18+ fetch, fs, path stdlib only.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// --- Load key from .env.local (never echoed) ---
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const KEY = env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error('OPENROUTER_API_KEY missing from .env.local');
  process.exit(1);
}

// --- Model selection (latest frontier variants, April 2026) ---
const COUNCIL = [
  { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'x-ai/grok-4.20', label: 'Grok 4.20' },
];
const CHAIRMAN = { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7' };

// --- Load spec ---
const SPEC = readFileSync(
  'docs/superpowers/specs/2026-04-18-spec-graph-v1-design.md',
  'utf8'
);
console.log(`Spec loaded: ${SPEC.length} chars, ${SPEC.split('\n').length} lines`);

// --- Prompts ---
const STAGE1_SYSTEM =
  'You are a rigorous, opinionated senior technical reviewer with deep experience in AI coding platforms, product design specs, and shipping systems at scale. Cite section numbers. Be specific. Do not soften feedback. Disagree with orthodoxy when warranted.';

const STAGE1_PROMPT = `You are critiquing a foundational product design specification.

**Context:** This spec defines "Atlas Spec Graph v1" — a typed, queryable, file-canonical data model that serves as the architectural source of truth for an AI-native website/app builder. The builder handles creation AND maintenance (iteration, bug fixes, dep upgrades, refactors) through a unified "Visualize → Agree → Build" ritual, with persona tiers (non-technical Ama / developer Diego / senior reviewer Priya), AST-based visual editing, live preview with shareable links, a 7-layer test pyramid, security/compliance-by-default (HIPAA/PCI/DPDP/GDPR/etc.), AI feature integration, media generation via provider adapters, DBaaS tiers (SQLite/Neon/OpenEverest), and 7 prebuilt E2B sandbox templates.

**Your critique must cover five dimensions.** For each, cite section numbers and be SPECIFIC. Generic observations waste everyone's time.

### (1) STRUCTURAL / ARCHITECTURAL RISK
What assumptions in this design are likely to break at scale, under concurrent use, or in adversarial conditions? What is the weakest load-bearing part? What regret-level decisions are hiding here?

### (2) GAPS FOR WORLD-CLASS STATUS
What would a truly best-in-class AI builder PRD include that this spec misses? Think about what Anthropic's, Vercel's, Google's, or OpenAI's internal teams would demand before signing off. What's absent that *must* be present?

### (3) OVER-ENGINEERING FOR V1
What in this spec is unnecessary for first release and should be deferred? Be ruthless. V1s win by shipping.

### (4) HIDDEN ASSUMPTIONS / UNACKNOWLEDGED TRADE-OFFS
What implicit choices has the author made without stating them? What trade-offs are glossed over? Where is the spec confidently wrong?

### (5) GENUINELY GOOD
Don't just criticize. What is right about this spec? What would be a mistake to change? What would you steal for your own work?

Be decisive. Format your critique as five clearly labeled sections matching the numbering above. 800–1500 words total.

---SPEC---

${SPEC}`;

const STAGE2_SYSTEM =
  'You are analyzing four peer reviews of a product spec and producing a meta-critique. Be specific. Cite reviewer labels (A/B/C/D) and original spec sections. Your goal is to surface convergence, resolve disagreements, and find blind spots.';

const stage2Prompt = (anonymizedReviews) => `Four senior reviewers independently critiqued the same product spec for "Atlas Spec Graph v1" — a foundational data model for an AI website/app builder. Their reviews are below, anonymized as Reviewer A, B, C, D.

**Your task — four sections:**

### (1) AGREEMENT — What did they converge on?
Which critiques are raised by 2+ reviewers? Convergent observations are likely REAL issues. List the top 5 with the reviewers who raised each.

### (2) DISAGREEMENT — Where do they conflict?
For each meaningful disagreement, pick a side with reasoning. Vague "both have a point" answers are forbidden.

### (3) BLIND SPOTS OF THE GROUP
What important issues did NONE of the four reviewers raise that should have been raised? Focus on structural gaps, not nit-picks.

### (4) RANKING
Rank the four reviewers A/B/C/D 1st through 4th by quality of critique (most specific + actionable + non-obvious first). One sentence justifying each ranking.

Be direct. Cite specifically. 600–1000 words total.

---REVIEWS---

${anonymizedReviews}`;

const STAGE3_SYSTEM =
  'You are the Chairman of an LLM Council of frontier AI models that just reviewed a foundational product spec. Your job is to produce the final actionable verdict that the implementation team will follow. Be decisive. Prioritize. Do not hedge.';

const stage3Prompt = (allInput) => `You are the Chairman. Four LLM Council reviewers gave independent critiques of the Atlas Spec Graph v1 product spec, then peer-reviewed each other. All input is below.

Produce the final verdict in exactly this structure:

## TOP 5 CHANGES WE MUST MAKE (before implementation begins)
For each: **what to change**, **which spec section**, **why it matters**. Number them 1–5, strongest first.

## TOP 3 CHANGES WE SHOULD MAKE (valuable, not blocking)
Same format.

## TOP 3 "DO NOT CHANGE" — council-validated strengths
Call these out explicitly so the implementation team protects them.

## BLIND SPOTS THE COUNCIL MISSED
What did none of the four reviewers raise that you — as Chairman with the full picture — believe is a real issue? Be honest even if it undermines the council's apparent consensus.

## OVERALL VERDICT
One paragraph. Is this spec shippable-worthy (after must-changes), or does it need a structural rewrite? Pick one and justify.

Be decisive. No hedging. No "it depends." 800–1500 words.

---COUNCIL INPUT BELOW---

${allInput}`;

// --- OpenRouter API helper ---
async function complete(modelId, systemPrompt, userPrompt, maxTokens = 6000) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/atlas-labs/atlas',
      'X-Title': 'Atlas Spec Graph v1 Council Review',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${modelId} → ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  const usage = json.usage;
  return { content, usage };
}

// --- Stage 1: independent critiques (parallel) ---
async function stage1() {
  console.log('\n=== STAGE 1: First Opinions (4 parallel) ===');
  const results = await Promise.all(
    COUNCIL.map(async (m, idx) => {
      try {
        const start = Date.now();
        const { content, usage } = await complete(m.id, STAGE1_SYSTEM, STAGE1_PROMPT, 5000);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(
          `  ✓ ${m.label.padEnd(20)} (${content.length} chars, ${usage?.prompt_tokens || '?'}→${usage?.completion_tokens || '?'} tok, ${elapsed}s)`
        );
        return { ...m, anonLabel: String.fromCharCode(65 + idx), content, usage };
      } catch (e) {
        console.error(`  ✗ ${m.label}: ${e.message.slice(0, 200)}`);
        return { ...m, anonLabel: String.fromCharCode(65 + idx), content: null, error: e.message };
      }
    })
  );
  return results;
}

// --- Stage 2: peer review (parallel, anonymized) ---
async function stage2(firstOpinions) {
  console.log('\n=== STAGE 2: Peer Review (anonymized, 4 parallel) ===');
  const valid = firstOpinions.filter((o) => o.content);
  if (valid.length < 2) {
    console.error('Not enough valid Stage 1 responses for peer review');
    return [];
  }
  const anonymized = valid
    .map((o) => `### Reviewer ${o.anonLabel}\n\n${o.content}`)
    .join('\n\n---\n\n');

  const prompt = stage2Prompt(anonymized);
  const results = await Promise.all(
    COUNCIL.map(async (m) => {
      try {
        const start = Date.now();
        const { content, usage } = await complete(m.id, STAGE2_SYSTEM, prompt, 4000);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(
          `  ✓ ${m.label.padEnd(20)} (${content.length} chars, ${usage?.prompt_tokens || '?'}→${usage?.completion_tokens || '?'} tok, ${elapsed}s)`
        );
        return { ...m, content, usage };
      } catch (e) {
        console.error(`  ✗ ${m.label}: ${e.message.slice(0, 200)}`);
        return { ...m, content: null, error: e.message };
      }
    })
  );
  return { anonymized, peerReviews: results };
}

// --- Stage 3: Chairman synthesis ---
async function stage3(firstOpinions, peerReviewBundle) {
  console.log(`\n=== STAGE 3: Chairman Synthesis (${CHAIRMAN.label}) ===`);
  const validFirst = firstOpinions.filter((o) => o.content);
  const validPeers = peerReviewBundle.peerReviews.filter((p) => p.content);
  if (validFirst.length === 0 || validPeers.length === 0) {
    console.error('Cannot run Chairman without stage 1 + 2 outputs');
    return { content: null };
  }
  const firstBlock = validFirst
    .map((o) => `### First Opinion by Reviewer ${o.anonLabel}\n\n${o.content}`)
    .join('\n\n---\n\n');
  const peerBlock = validPeers
    .map((p, i) => `### Peer Review ${i + 1}\n\n${p.content}`)
    .join('\n\n---\n\n');
  const fullInput = `## FIRST OPINIONS\n\n${firstBlock}\n\n## PEER REVIEWS\n\n${peerBlock}`;

  try {
    const start = Date.now();
    const { content, usage } = await complete(
      CHAIRMAN.id,
      STAGE3_SYSTEM,
      stage3Prompt(fullInput),
      8000
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `  ✓ Chairman (${content.length} chars, ${usage?.prompt_tokens || '?'}→${usage?.completion_tokens || '?'} tok, ${elapsed}s)`
    );
    return { content, usage };
  } catch (e) {
    console.error(`  ✗ Chairman failed: ${e.message.slice(0, 300)}`);
    return { content: null, error: e.message };
  }
}

// --- Main pipeline ---
async function main() {
  const t0 = Date.now();
  const firstOpinions = await stage1();
  const peerBundle = await stage2(firstOpinions);
  const chairmanOut = await stage3(firstOpinions, peerBundle);

  // Build report
  const date = '2026-04-18';
  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Token + cost tally (rough)
  let totalInTok = 0;
  let totalOutTok = 0;
  for (const o of [...firstOpinions, ...peerBundle.peerReviews, chairmanOut]) {
    if (o?.usage) {
      totalInTok += o.usage.prompt_tokens || 0;
      totalOutTok += o.usage.completion_tokens || 0;
    }
  }

  const report = `# Atlas Spec Graph v1 — LLM Council Review (Pass 1)

**Date:** ${date}
**Protocol:** Karpathy LLM Council (Stage 1 → Stage 2 peer review → Chairman synthesis)
**Council:** ${COUNCIL.map((c) => c.label).join(' · ')}
**Chairman:** ${CHAIRMAN.label}
**Runtime:** ${totalElapsed}s wall-clock
**Tokens:** ${totalInTok.toLocaleString()} in · ${totalOutTok.toLocaleString()} out (15 calls total)
**Spec reviewed:** \`docs/superpowers/specs/2026-04-18-spec-graph-v1-design.md\` (${SPEC.length.toLocaleString()} chars, ${SPEC.split('\n').length} lines)

---

## Chairman Final Synthesis (${CHAIRMAN.label})

${chairmanOut.content || `ERROR: ${chairmanOut.error}`}

---

## Stage 1 — First Opinions

${firstOpinions
  .map(
    (o) =>
      `### ${o.anonLabel}. ${o.label} (\`${o.id}\`)\n\n${
        o.content || `ERROR: ${o.error}`
      }`
  )
  .join('\n\n---\n\n')}

---

## Stage 2 — Peer Reviews (each reviewer critiquing the anonymized set)

${peerBundle.peerReviews
  .map(
    (p) =>
      `### ${p.label} (\`${p.id}\`)\n\n${p.content || `ERROR: ${p.error}`}`
  )
  .join('\n\n---\n\n')}

---

## Anonymization Key (for audit)

${COUNCIL.map((c, i) => `- Reviewer ${String.fromCharCode(65 + i)} = ${c.label} (\`${c.id}\`)`).join('\n')}
`;

  mkdirSync('docs/council-review', { recursive: true });
  const outPath = `docs/council-review/${date}-spec-graph-v1-pass1.md`;
  writeFileSync(outPath, report);
  console.log(`\n✓ Report written: ${outPath}`);
  console.log(`  Wall-clock: ${totalElapsed}s · Tokens: ${totalInTok.toLocaleString()} in / ${totalOutTok.toLocaleString()} out`);
}

main().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
