import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('admin never contains a custom login form', () => {
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /type=["']password|auth\/login|admin\/handoff/i);
  assert.match(source, /api\/v1\/admin\/session/);
});

test('every declared mutation opts into CSRF', () => {
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const mutations = [...source.matchAll(/method:\s*'(?:POST|PATCH|PUT|DELETE)'/g)];
  assert.ok(mutations.length >= 3);
  assert.equal((source.match(/mutation:\s*true/g) || []).length, mutations.length);
});
