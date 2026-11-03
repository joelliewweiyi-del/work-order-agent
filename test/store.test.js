import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../src/store.js';

const register = JSON.parse(readFileSync(new URL('../data/register.json', import.meta.url)));
const store = () => createStore(register, { extractor: 'rules', env: {}, now: () => new Date(Date.UTC(2026, 10, 3, 9)) });
const leak = { from: 'ruth.adeyemi@example.com', subject: 'Leak', body: 'Water is leaking through the ceiling in flat 2A.' };
const unknown = { from: 'x@unknown.example', subject: 'Gas', body: 'There is a smell of gas outside flat 7.' };

test('a draft goes sent, scheduled, done, in that order only', async () => {
  const s = store();
  const { mail: { id } } = await s.receive(leak);
  assert.throws(() => s.act(id, 'complete'), /cannot complete a draft item/);
  for (const [action, status] of [['approve', 'sent'], ['schedule', 'scheduled'], ['complete', 'done']])
    assert.equal(s.act(id, action).status, status);
  assert.throws(() => s.act(id, 'approve'), /cannot approve a done item/);
});

test('a person can change the draft when approving', async () => {
  const s = store();
  const { mail: { id } } = await s.receive(leak);
  const item = s.act(id, 'approve', { edits: { contractor: 'allfix', urgency: 'urgent' } });
  assert.deepEqual([item.draft.contractor, item.draft.urgency], ['allfix', 'urgent']);
  assert.match(item.timeline.at(-1).text, /sent to Allfix Maintenance/);
});

test('a draft without a unit cannot be approved until a person sets one', async () => {
  const s = store();
  const item = await s.receive(unknown);
  assert.throws(() => s.act(item.mail.id, 'approve', { edits: { urgency: 'routine' } }), /set the unit/);
  assert.equal(item.draft.urgency, 'emergency', 'a refused approval changes nothing');
  assert.equal(item.status, 'draft');
  s.act(item.mail.id, 'approve', { edits: { unit: 'mill-7' } });
  assert.equal(item.draft.location, 'Millbrook House, unit 7, London N1 7GU');
});

test('only the draft fields a person should touch can be edited', async () => {
  const s = store();
  const { mail: { id } } = await s.receive(leak);
  assert.throws(() => s.act(id, 'approve', { edits: { due: '2030-01-01' } }), /cannot edit due/);
  assert.throws(() => s.act(id, 'approve', { edits: { contractor: 'nobody' } }), /unknown contractor/);
});

test('action names are looked up as own keys only, not inherited ones', async () => {
  const s = store();
  const { mail: { id } } = await s.receive(leak);
  for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
    assert.throws(() => s.act(id, action), /cannot/, action);
  assert.equal(s.get(id).status, 'draft');
});

test('an urgency edit must be a known level and moves the deadline with it', async () => {
  const s = store();
  const item = await s.receive(leak);
  assert.throws(() => s.act(item.mail.id, 'approve', { edits: { urgency: 'whenever' } }), /unknown urgency/);
  assert.equal(item.status, 'draft');
  s.act(item.mail.id, 'approve', { edits: { urgency: 'routine' } });
  assert.equal(new Date(item.draft.due) - new Date(item.mail.received), 120 * 3600_000);
});
