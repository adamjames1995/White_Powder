// Powder AI game plan: from the top of the lift you're riding (or where you stand), which run → which lift next.
// Weighs live lift lines, your terrain level, groomed vs powder, and variety. Pure logic for testing.
import { dist, distToLine, matchName } from './skiarea.js';

const ORDER = ['green', 'blue', 'black', 'expert'];
export const LEVELS = { green: 'Greens', blue: 'Blues', black: 'Blacks', expert: 'Expert' };
export const SNOW = { groomed: 'Groomed', powder: 'Powder', any: 'Either' };

/** Feed lift (name, status, wait) for a mapped lift, if the resort publishes one. */
export const feedFor = (lift, feedLifts) => matchName(lift.name, feedLifts || [], (x) => x.name, 0.6);

/**
 * @param area {lifts, runs} map geometry; from = [lat,lon] start point (top of current lift or your position)
 * @param o { feedLifts, resortRuns, level, snow, doneRuns:Set, doneLifts:Map(name→count), excludeLift }
 * @returns up to 3 options [{ run, lift, wait, score, why[] }]
 */
export function plan(area, from, o = {}) {
  if (!area?.lifts?.length || !from) return [];
  const lvl = ORDER.indexOf(o.level || 'blue');
  const out = [];
  const near = 160;
  // runs that pass close to where you are; ski from that point down
  for (const run of area.runs) {
    if (!run.coords?.length) continue;
    const at = distToLine(from, run.coords);
    if (at.d > near || at.frac > 0.85) continue;
    const di = ORDER.indexOf(run.diff);
    if (di > lvl && !(o.level === 'expert')) continue; // above your level
    const end = run.coords[run.coords.length - 1];
    const fr = matchName(run.name, o.resortRuns || [], (x) => x.name, 0.7);
    if (fr && fr.open === false) continue;
    for (const lift of area.lifts) {
      if (lift.coords.length < 2 || (o.excludeLift && lift.name === o.excludeLift && dist(end, lift.coords[0]) > 400)) continue;
      const bottom = lift.coords[0];
      const dEnd = Math.min(dist(end, bottom), distToLine(bottom, run.coords).d);
      if (dEnd > 220) continue;
      const f = feedFor(lift, o.feedLifts);
      if (f && f.status && f.status !== 'open') continue;
      const wait = f?.wait ?? null;
      const why = [];
      let score = 0;
      // lift line (unknown waits assumed ~6 min)
      score += wait == null ? 6 : wait;
      // terrain: right at your level is best
      const gap = lvl - Math.max(0, di);
      score += gap * 3;
      if (gap === 0) why.push(`${run.diff} like you wanted`);
      // snow preference
      const groomed = fr ? fr.groomed : (run.groomTag ? !/backcountry|mogul|none/i.test(run.groomTag) : null);
      if (o.snow === 'groomed') { if (groomed === true) { score -= 3; why.push('groomed today'); } else if (groomed === false) score += 2; }
      if (o.snow === 'powder') { if (groomed === false) { score -= 3; why.push('ungroomed'); } else if (groomed === true) score += 2; }
      // variety
      const runsDone = o.doneRuns?.has(run.name) ? 1 : 0;
      const liftsDone = o.doneLifts?.get(lift.name) || 0;
      score += runsDone * 3 + liftsDone * 1.5;
      if (!runsDone && run.name) why.push('new run today');
      // longer runs are a bit more fun
      const len = run.coords.reduce((t, c, k) => (k ? t + dist(run.coords[k - 1], c) : 0), 0) * (1 - at.frac);
      score -= Math.min(3, len / 600);
      out.push({ run, lift, wait, groomed, score: +score.toFixed(2), why });
    }
  }
  // keep the best option per lift, then the best 3 overall
  const best = new Map();
  for (const x of out.sort((a, b) => a.score - b.score)) if (!best.has(x.lift.name)) best.set(x.lift.name, x);
  let res = [...best.values()].slice(0, 3);
  if (!res.length) { // no mapped run connects: nearest open lifts with short lines
    res = area.lifts.map((lift) => {
      const f = feedFor(lift, o.feedLifts);
      const d = dist(from, lift.coords[0]);
      return { run: null, lift, wait: f?.wait ?? null, score: d / 150 + (f?.wait ?? 6), why: [`${Math.round(d)} m away`] , closed: f && f.status && f.status !== 'open' };
    }).filter((x) => !x.closed && x.lift.name !== o.excludeLift).sort((a, b) => a.score - b.score).slice(0, 3);
  }
  return res;
}

/** Is `next` a meaningfully better plan than `prev` (for "better line" alerts)? */
export function isBetter(prev, next) {
  if (!prev || !next) return false;
  if (prev.lift.name === next.lift.name) return false;
  const pw = prev.wait ?? 6, nw = next.wait ?? 6;
  return next.score <= prev.score - 4 && nw <= pw - 4;
}
