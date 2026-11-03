// Scores the agent against data/eval.json: kind, trade, urgency and the unit it ends on.
// usage: npm run eval              (offline rules)
//        npm run eval -- --llm     (needs LLM_API_KEY or XAI_API_KEY, see README)
import { readFileSync } from 'node:fs';
import { runAgent } from '../src/agent.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const register = read('../data/register.json');
const inbox = new Map(read('../data/inbox.json').map((m) => [m.id, m]));
const { cases } = read('../data/eval.json');
const extractor = process.argv.includes('--llm') ? 'llm' : 'rules';
const env = extractor === 'llm' ? process.env : {};

const COLS = ['kind', 'trade', 'urgency', 'unit'];
const hits = [0, 0, 0, 0];
let exact = 0;
for (const c of cases) {
  const mail = inbox.get(c.id) ?? { id: c.id, from: c.from, subject: c.subject, body: c.body };
  const r = await runAgent(mail, register, { extractor, env });
  const got = [r.kind, r.draft?.trade ?? null, r.draft?.urgency ?? null, r.unit && !r.draft?.location.startsWith('unknown') ? r.unit.unit : r.kind === 'forward' ? r.unit?.unit ?? null : null];
  const ok = got.map((g, i) => g === c.expected[i]);
  ok.forEach((o, i) => { if (o) hits[i]++; });
  if (ok.every(Boolean)) exact++;
  console.log(`${ok.every(Boolean) ? '✓' : '✗'} ${c.id.padEnd(3)} ${got.map((g, i) => (ok[i] ? '' : '≠') + (g ?? '-')).join(' / ')}${ok.every(Boolean) ? '' : `   expected ${c.expected.map((e) => e ?? '-').join(' / ')}`}`);
}
const pct = (n) => `${Math.round((100 * n) / cases.length)}%`;
console.log(`\n${extractor}: ${exact}/${cases.length} fully right (${pct(exact)}) · ${COLS.map((k, i) => `${k} ${pct(hits[i])}`).join(' · ')}`);
