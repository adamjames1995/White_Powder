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

test('vail feed merges grooming-area lifts and prefers the page count', async () => {
  const { fromVailHtml, summarize } = await import('../api/status.js');
  const feed = { Lifts: [{ Id: 1, Name: 'A', Status: 1 }], GroomingAreas: [{ Lifts: [{ Id: 1, Name: 'A', Status: 1 }, { Id: 2, Name: 'B', Status: 0 }, { Id: 3, Name: 'C', Status: 2 }] }] };
  const html = `<div><span>1</span> / <span>3</span><p>Lifts Open</p></div><script>FR.TerrainStatusFeed = ${JSON.stringify(feed)};</script>`;
  const s = summarize(fromVailHtml(html));
  assert.equal(s.open, 1); assert.equal(s.total, 3); assert.equal(s.hold, 1);
  const s2 = summarize(fromVailHtml(`<script>FR.TerrainStatusFeed = ${JSON.stringify(feed)};</script>`));
  assert.equal(s2.total, 3);
});
