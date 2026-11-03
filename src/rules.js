// Offline triage: keyword rules over the sentences of the mail. Every value comes with the
// sentence it was found in, so the same trace check applies as for an LLM.

export const TRADES = {
  plumbing: /\b(leak\w*|water|tap|drip\w*|toilet|drain|pipe|flood\w*)\b/i,
  heating: /\b(radiator\w*|boiler|heating|hot water|gas)\b/i,
  electrical: /\b(light\w*|power|socket|fuse|electric\w*|flicker\w*)\b/i,
  locks: /\b(lock\w*|key|bolt)\b/i,
};
const REPAIR = /\b(broken|not working|doesn't work|won't|stopped|damaged|repair)\b/i;
const NOT_WORK = /\b(rent|invoice|payment|standing order|deposit|contract|lease)\b/i;

// First match wins, from the most serious down.
export const URGENCY = [
  { level: 'emergency', re: /\bwater\b.*\b(ceiling|light|electric\w*)\b|\bceiling\b.*\bleak\w*/i },
  { level: 'emergency', re: /\b(gas smell|smell of gas|flood\w*|can't secure|cannot secure|no power)\b/i },
  { level: 'routine', re: /\b(not urgent|no rush)\b/i },
  { level: 'urgent', re: /\b(cold|no heating|no hot water|today|asap|urgent)\b/i },
  { level: 'routine', re: /\b(next week|when you can)\b/i },
];
const UNIT = /\b(?:flat|unit|apartment|apt\.?)\s+(\d+[A-Z]?)\b|\b(\d+[A-Z])\b/i;

export const sentences = (text) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

export function triageWithRules(mail) {
  const all = sentences(`${mail.subject}\n${mail.body}`);
  const field = (key, value, quote) => ({ key, value, page: 1, quote });
  const find = (re) => all.find((s) => re.test(s));

  // Work order or not: a repair word or a trade word, and the trade words must outweigh admin words.
  const tradeHits = Object.entries(TRADES).map(([trade, re]) => [trade, all.filter((s) => re.test(s)).length]);
  const [trade, hits] = tradeHits.sort((a, b) => b[1] - a[1])[0];
  const admin = all.filter((s) => NOT_WORK.test(s)).length;
  const isWorkOrder = (hits > 0 || all.some((s) => REPAIR.test(s))) && hits >= admin;

  const unitQuote = find(UNIT);
  const unitMatch = unitQuote?.match(UNIT);
  const fields = [field('unit', unitMatch ? (unitMatch[1] ?? unitMatch[2]) : null, unitQuote ?? null)];
  if (!isWorkOrder) return { isWorkOrder, trade: null, urgency: null, fields };

  const chosenTrade = hits > 0 ? trade : 'general';
  // The issue is the first body sentence about the trade; the subject line is the fallback.
  const body = sentences(mail.body);
  const re = hits > 0 ? TRADES[trade] : REPAIR;
  const issueQuote = body.find((s) => re.test(s)) ?? find(re) ?? all[0];
  fields.push(field('issue', issueQuote, issueQuote));
  const u = URGENCY.map((x) => ({ ...x, quote: find(x.re) })).find((x) => x.quote);
  fields.push(field('urgency', u ? u.quote.match(u.re)[0] : null, u?.quote ?? null));
  return { isWorkOrder, trade: chosenTrade, urgency: u?.level ?? 'routine', fields };
}
