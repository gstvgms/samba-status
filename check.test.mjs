// node --test
import assert from 'node:assert/strict';
import test from 'node:test';
import { dayOf, probe, record } from './check.mjs';

const T0 = Date.parse('2026-11-10T15:00:00Z');
const MIN = 60_000;

test('a drop opens an incident, the return closes it, and the day counts both', () => {
  let state = record(null, { site: { ms: 120 } }, T0);
  state = record(state, { site: { ms: null } }, T0 + 5 * MIN);
  assert.equal(state.services.site.status, 'down');
  assert.deepEqual(state.incidents, [{ service: 'site', start: T0 + 5 * MIN, end: null }]);
  state = record(state, { site: { ms: null } }, T0 + 10 * MIN);
  assert.equal(state.incidents.length, 1, 'still the same incident');
  state = record(state, { site: { ms: 90 } }, T0 + 15 * MIN);
  assert.equal(state.incidents[0].end, T0 + 15 * MIN);
  assert.equal(state.services.site.since, T0 + 15 * MIN);
  assert.deepEqual(state.services.site.days[dayOf(T0)], [2, 4]);
});

test('keeps 90 days and 24 hours of checks', () => {
  let state = record(null, { site: { ms: 1 } }, T0);
  state = record(state, { site: { ms: 1 } }, T0 + 100 * 86_400_000);
  assert.deepEqual(Object.keys(state.services.site.days), [dayOf(T0 + 100 * 86_400_000)]);
  assert.equal(state.services.site.recent.length, 1);
  assert.equal(state.started, T0);
});

test('the day is the Brazilian one', () => {
  assert.equal(dayOf(Date.parse('2026-11-11T02:00:00Z')), '2026-11-10');
});

test('one failed try is retried before calling it down', async () => {
  let calls = 0;
  const flaky = { check: async () => (++calls === 1 ? Promise.reject(new Error('blip')) : 42) };
  assert.deepEqual(await probe(flaky, 1), { ms: 42, error: null });
  const dead = { check: async () => Promise.reject(new Error('HTTP 503')) };
  assert.deepEqual(await probe(dead, 1), { ms: null, error: 'HTTP 503' });
});
