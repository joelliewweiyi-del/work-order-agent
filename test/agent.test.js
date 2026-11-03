import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAgent, SLA_HOURS } from '../src/agent.js';

const register = JSON.parse(readFileSync(new URL('../data/register.json', import.meta.url)));
const NOW = new Date(Date.UTC(2026, 10, 3, 9));
const offline = { extractor: 'rules', env: {}, now: NOW };
const failed = (r) => r.steps.filter((s) => !s.ok).map((s) => s.name);

test('a known tenant with a clear repair gets a clean draft for the right contractor', async () => {
  const r = await runAgent({ id: 'a', from: 'leo.fischer@example.com', subject: 'Tap', body: 'The kitchen tap in 5C drips constantly.' }, register, offline);
  assert.equal(r.kind, 'work-order');
  assert.deepEqual(failed(r), []);
  assert.equal(r.draft.contractor, 'flowfix');
  assert.equal(r.draft.location, '22 Canal Street, unit 5C, London E2 8QR');
  assert.deepEqual(r.draft.flags, []);
});

test('the deadline follows the urgency', async () => {
  const r = await runAgent({ id: 'b', from: 'hana.sato@example.com', subject: 'Heating', body: 'The radiators in unit 12 are cold.' }, register, offline);
  assert.equal(r.draft.urgency, 'urgent');
  assert.equal(new Date(r.draft.due) - NOW, SLA_HOURS.urgent * 3600_000);
});

test('a unit in the mail that differs from the sender\'s unit is flagged and left blank', async () => {
  const r = await runAgent({ id: 'c', from: 'leo.fischer@example.com', subject: 'Toilet', body: 'The toilet in flat 2A keeps running.' }, register, offline);
  assert.deepEqual(failed(r), ['Match the sender to a unit', 'Draft the work order']);
  assert.match(r.draft.location, /^unknown/);
  assert.match(r.draft.flags[0], /sender rents unit 5C, the mail says unit 2A/);
});

test('an unknown sender is flagged', async () => {
  const r = await runAgent({ id: 'd', from: 'x@unknown.example', subject: 'Leak', body: 'Water is leaking under the sink in flat 7.' }, register, offline);
  assert.match(r.draft.flags[0], /not a known tenant contact/);
});

test('admin questions are routed, not turned into work orders', async () => {
  const r = await runAgent({ id: 'e', from: 'owen.price@example.com', subject: 'Rent', body: 'Can you confirm my rent after the review?' }, register, offline);
  assert.equal(r.kind, 'forward');
  assert.equal(r.draft, null);
});

// A fake model that is right about the issue and invents the unit.
const fakeModel = async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({
    isWorkOrder: true, trade: 'plumbing', urgency: 'routine',
    fields: [
      { key: 'unit', value: '9C', quote: 'The kitchen tap in 9C drips.' },
      { key: 'issue', value: 'The kitchen tap drips constantly.', quote: 'The kitchen tap drips constantly.' },
    ],
  }) } }] }),
});

test('a unit the model invents is rejected and the sender decides the unit', async () => {
  const r = await runAgent({ id: 'f', from: 'leo.fischer@example.com', subject: 'Tap', body: 'The kitchen tap drips constantly.' },
    register, { env: { XAI_API_KEY: 'k' }, fetchFn: fakeModel, now: NOW });
  assert.equal(r.fields.find((f) => f.key === 'unit').status, 'rejected');
  assert.equal(r.fields.find((f) => f.key === 'issue').status, 'traced');
  assert.equal(r.unit.unit, '5C');
  assert.match(r.draft.flags.join(' '), /Unit: quote not found/);
});
