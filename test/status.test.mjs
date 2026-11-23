import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../api/status.js';

test('status summarize: counts, holds, url', () => {
  const j = { name: 'Palisades', url: { host: 'https://www.palisadestahoe.com', pathname: '/mountain-information/lift-and-grooming-status' },
    lifts: { status: { 'KT-22': 'hold', Funitel: 'open', 'Big Blue': 'open', Siberia: 'closed' }, stats: { open: 2, hold: 1, scheduled: 0, closed: 1 } } };
  const s = summarize(j);
  assert.equal(s.open, 2); assert.equal(s.total, 4); assert.deepEqual(s.holdLifts, ['KT-22']);
  assert.equal(s.url, 'https://www.palisadestahoe.com/mountain-information/lift-and-grooming-status');
  assert.equal(summarize({}).total, 0);
});
