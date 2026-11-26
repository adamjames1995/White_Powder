import test from 'node:test';
import assert from 'node:assert/strict';
import { DayTracker } from '../lib/track.js';
import { plan, isBetter } from '../lib/plan.js';
import { buildArea, nameScore, matchName } from '../lib/skiarea.js';

// A tiny mountain: two lifts from the base (39.000) to the top (39.006), two runs back down.
const B = [39.0, -120.0], T = [39.006, -120.0];
const area = {
  lifts: [
    { name: 'KT-22', coords: [B, T] },
    { name: 'Red Dog', coords: [[39.0, -120.004], [39.005, -120.004]] },
  ],
  runs: [
    { name: 'Mountain Run', diff: 'blue', coords: [T, [39.003, -120.001], [39.0002, -120.0003]] },
    { name: 'Chute 75', diff: 'expert', coords: [T, [39.002, -120.002], [39.0001, -120.0002]] },
    { name: 'Easy Street', diff: 'green', coords: [[39.0055, -120.0005], [39.003, -120.003], [39.0002, -120.0038]] },
  ],
};

function simulate(tr, t0, legs) {
  let t = t0;
  for (const [from, to, altFrom, altTo, secs] of legs) {
    for (let s = 0; s <= secs; s += 3) {
      const f = s / secs;
      tr.add({ t: t + s * 1000, lat: from[0] + (to[0] - from[0]) * f, lon: from[1] + (to[1] - from[1]) * f, alt: altFrom + (altTo - altFrom) * f + (Math.random() - 0.5) * 4, acc: 8, speed: null });
    }
    t += secs * 1000;
  }
  return t;
}

test('tracks lift rides and runs with names, vertical and speed', () => {
  const tr = new DayTracker({ area, resortRuns: [{ name: 'Mountain Run', groomed: true, open: true }] });
  let t = Date.UTC(2026, 11, 20, 17);
  t = simulate(tr, t, [[B, B, 2000, 2000, 60]]); // standing at base
  for (let i = 0; i < 2; i++) {
    t = simulate(tr, t, [[B, T, 2000, 2400, 300]]);           // ride up 400 m in 5 min
    t = simulate(tr, t, [[T, T, 2400, 2400, 45]]);            // pause at top
    t = simulate(tr, t, [[T, [39.003, -120.001], 2400, 2200, 60], [[39.003, -120.001], [39.0002, -120.0003], 2200, 2000, 60]]); // ski Mountain Run
    t = simulate(tr, t, [[B, B, 2000, 2000, 60]]);            // line at bottom
  }
  tr.finish();
  const s = tr.stats();
  assert.equal(s.lifts, 2, `lifts ${s.lifts}`);
  assert.equal(s.runs, 2, `runs ${s.runs}`);
  assert.ok(s.vertFt > 2200 && s.vertFt < 2900, `vert ${s.vertFt}`);
  assert.equal(tr.rides[0].name, 'KT-22');
  assert.equal(tr.runs[0].name, 'Mountain Run');
  assert.equal(tr.runs[0].groomed, true);
  assert.ok(s.topMph > 5 && s.topMph < 40, `top ${s.topMph}`);
  // survives a save/restore
  const back = new DayTracker({ area, saved: JSON.parse(JSON.stringify(tr.toJSON())) });
  assert.equal(back.stats().runs, 2);
});

test('game plan respects level, lines and variety', () => {
  const feed = [{ name: '#1 KT-22 Express', status: 'open', wait: 15 }, { name: 'Red Dog Chair', status: 'open', wait: 2 }];
  const opts = plan(area, T, { feedLifts: feed, level: 'blue', snow: 'any', doneRuns: new Set(), doneLifts: new Map() });
  assert.ok(opts.length >= 1);
  assert.ok(opts.every((o) => !o.run || o.run.diff !== 'expert'), 'no expert runs for a blue skier');
  assert.equal(opts[0].lift.name, 'Red Dog', 'shorter line wins');
  const expert = plan(area, T, { feedLifts: feed, level: 'expert', doneRuns: new Set(), doneLifts: new Map() });
  assert.ok(expert.length >= 1);
  assert.ok(isBetter({ lift: { name: 'A' }, wait: 15, score: 15 }, { lift: { name: 'B' }, wait: 2, score: 4 }));
});

test('lift names match across feed and map', () => {
  assert.ok(nameScore('#6 Cornice Express', 'Cornice') >= 0.6);
  assert.equal(matchName('KT-22', [{ name: 'KT-22 Express' }, { name: 'Red Dog' }])?.name, 'KT-22 Express');
  const a = buildArea([{ type: 'way', id: 1, tags: { aerialway: 'chair_lift', name: 'X' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1.01, lon: 2 }] }, { type: 'way', id: 2, tags: { 'piste:type': 'downhill', 'piste:difficulty': 'advanced', name: 'Y' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1.01, lon: 2 }] }]);
  assert.equal(a.lifts.length, 1); assert.equal(a.runs[0].diff, 'black');
});
