import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, fromMtnpowder, fromVailHtml, coerce } from '../api/status.js';

test('mtnpowder lifts + reasons', () => {
  const lifts = fromMtnpowder([
    { Name: 'KT-22', StatusEnglish: 'Wind Hold' }, { Name: 'Funitel', StatusEnglish: 'Open' },
    { Name: 'Siberia', StatusEnglish: 'Wind Hold' }, { Name: 'Shirley', StatusEnglish: 'Closed' },
  ]);
  const s = summarize(lifts);
  assert.deepEqual([s.open, s.hold, s.closed, s.total], [1, 2, 1, 4]);
  assert.deepEqual(s.reasons, [{ text: 'Wind Hold', n: 2 }]);
});

test('vail TerrainStatusFeed parsing', () => {
  const html = '<html><script>var x=1;</script><script>FR.TerrainStatusFeed = {"Lifts":[{"Name":"Chair 6 ","Status":1},{"Name":"Chair 4","Status":2},{"Name":"Chair 7","Status":0}]};</script></html>';
  const s = summarize(fromVailHtml(html));
  assert.deepEqual([s.open, s.hold, s.closed], [1, 1, 1]);
  assert.equal(coerce('Closed for Season'), 'closed');
});
