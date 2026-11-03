// LLM triage over any OpenAI-compatible chat API (Grok by default, via doc-trace's config).
// The model must quote the mail for every value; the agent checks those quotes before it trusts them.
import { TRADES } from './rules.js';

const LEVELS = ['emergency', 'urgent', 'routine'];

export function buildPrompt(mail) {
  return [
    'You triage tenant mail for a property manager. Answer with JSON only:',
    '{"isWorkOrder": bool, "trade": one of ' + JSON.stringify([...Object.keys(TRADES), 'general']) + ' or null,',
    ' "urgency": one of ' + JSON.stringify(LEVELS) + ' or null,',
    ' "fields": [{"key": "unit"|"issue"|"urgency", "value": "...", "quote": "..."}]}',
    'isWorkOrder is true only when something in the property needs a repair or a visit.',
    'emergency: risk to people or property now (water near electrics, gas, flooding, cannot lock up).',
    'urgent: needs a visit within a day (no heating, no hot water). routine: everything else.',
    '`value` must be copied exactly from the mail. `quote` is the exact sentence that contains it.',
    'For "issue", the value is the sentence describing the problem. For "urgency", the words that show it.',
    'Use null for anything the mail does not say. Never guess a unit.',
    '',
    `Subject: ${mail.subject}`,
    mail.body,
  ].join('\n');
}

export async function triageWithLlm(mail, config, fetchFn = fetch) {
  const res = await fetchFn(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildPrompt(mail) }],
    }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  const out = JSON.parse((await res.json()).choices[0].message.content);
  const list = Array.isArray(out.fields) ? out.fields.filter((f) => f && typeof f === 'object') : [];
  const byKey = new Map(list.map((f) => [f.key, f]));
  const keys = out.isWorkOrder ? ['unit', 'issue', 'urgency'] : ['unit'];
  return {
    isWorkOrder: Boolean(out.isWorkOrder),
    trade: out.isWorkOrder ? (Object.hasOwn(TRADES, out.trade) || out.trade === 'general' ? out.trade : 'general') : null,
    urgency: out.isWorkOrder ? (LEVELS.includes(out.urgency) ? out.urgency : 'urgent') : null,
    fields: keys.map((key) => ({ key, value: byKey.get(key)?.value ?? null, page: 1, quote: byKey.get(key)?.quote ?? null })),
  };
}
