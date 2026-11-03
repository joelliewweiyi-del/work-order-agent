import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Quotes are highlighted with String.replace. A replacement string treats "$'" and "$&" as patterns,
// so mail text containing them would be duplicated into the page. Only a replacer function is safe.
test('highlighting uses a replacer function, so "$" in mail text is literal', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const calls = [...html.matchAll(/body\.replace\(esc\(f\.quote\),\s*(\S{2})/g)].map((m) => m[1]);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c === '()'), calls.join(' | '));
});
