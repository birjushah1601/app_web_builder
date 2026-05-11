// Smoke test: verify key works and resolve exact model IDs on OpenRouter
import { readFileSync } from 'node:fs';

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
  console.error('OPENROUTER_API_KEY missing');
  process.exit(1);
}

const res = await fetch('https://openrouter.ai/api/v1/models', {
  headers: { Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error('OpenRouter /models failed:', res.status, await res.text());
  process.exit(1);
}
const { data } = await res.json();

// Filter for the four council model families + Opus (Chairman)
const wanted = ['gpt-5', 'gemini-3', 'claude-sonnet-4', 'claude-opus-4', 'grok-4'];
const matches = data
  .filter((m) => wanted.some((w) => m.id.toLowerCase().includes(w)))
  .map((m) => ({ id: m.id, context: m.context_length, pricing: m.pricing }))
  .sort((a, b) => a.id.localeCompare(b.id));

console.log(`OpenRouter reachable. Found ${matches.length} candidate models:`);
for (const m of matches) {
  console.log(`  ${m.id}  (ctx=${m.context}, $in=${m.pricing?.prompt}, $out=${m.pricing?.completion})`);
}
