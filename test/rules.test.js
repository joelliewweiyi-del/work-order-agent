import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { triageWithRules } from '../src/rules.js';

const inbox = JSON.parse(readFileSync(new URL('../data/inbox.json', import.meta.url)));
const mail = (id) => inbox.find((m) => m.id === id);
const value = (r, key) => r.fields.find((f) => f.key === key)?.value;

test('each sample mail gets the expected trade, urgency and unit', () => {
  const expected = {
    m1: [true, 'plumbing', 'emergency', '2A'],
    m7: [true, 'heating', 'emergency', '7'],
    m2: [true, 'heating', 'urgent', '12'],
    m3: [true, 'plumbing', 'routine', '5C'],
    m4: [false, null, null, '7'],
    m5: [true, 'locks', 'emergency', '4B'],
    m6: [true, 'electrical', 'routine', '12'],
  };
  for (const [id, want] of Object.entries(expected)) {
    const r = triageWithRules(mail(id));
    assert.deepEqual([r.isWorkOrder, r.trade, r.urgency, value(r, 'unit')], want, id);
  }
});

test('"not urgent" is routine, not urgent', () => {
  const r = triageWithRules({ subject: 'Tap', body: 'The bathroom tap drips. Not urgent, today or tomorrow is fine.' });
  assert.equal(r.urgency, 'routine');
});

test('water near a light fitting is an emergency', () => {
  const r = triageWithRules({ subject: 'Leak', body: 'Water is dripping from the ceiling light in the kitchen.' });
  assert.deepEqual([r.trade, r.urgency], ['plumbing', 'emergency']);
});

test('every value is quoted from the mail', () => {
  for (const m of inbox) {
    const text = `${m.subject}\n${m.body}`;
    for (const f of triageWithRules(m).fields.filter((f) => f.value)) {
      assert.ok(text.includes(f.quote), `${m.id} ${f.key}`);
      assert.ok(f.quote.includes(f.value), `${m.id} ${f.key}`);
    }
  }
});
