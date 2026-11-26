// Powder AI tracking engine: turns a stream of GPS fixes into runs, lift rides and day stats.
// Pure logic (no DOM) so it can be tested by replaying a recorded or simulated day.
import { dist, nearestOf, matchName } from './skiarea.js';

const M2FT = 3.28084, MS2MPH = 2.23694;
const MIN_DROP = 30;      // m of descent for a segment to count as a run
const MIN_CLIMB = 40;     // m of climb for a lift ride
const HOLD = 25;          // s a new state must persist before we switch

export class DayTracker {
  constructor({ area = null, resortRuns = [], saved = null } = {}) {
    this.area = area; this.resortRuns = resortRuns;
    this.pts = []; this.state = 'idle'; this.pending = null;
    this.seg = null; this.runs = []; this.rides = []; this.alt = null;
    this.topSpeed = 0; this.peakAlt = -Infinity; this.start = null; this.last = null;
    if (saved) Object.assign(this, saved, { area, resortRuns });
  }

  /** Persistable snapshot (geometry excluded). Keeps a thinned track for the map. */
  toJSON() {
    const { pts, state, seg, runs, rides, alt, topSpeed, peakAlt, start, last } = this;
    return { pts: pts.length > 4000 ? pts.filter((_, i) => i % 2 === 0 || i > pts.length - 400) : pts, state, seg, runs, rides, alt, topSpeed, peakAlt, start, last };
  }

  /** p = { t (ms), lat, lon, alt (m|null), acc (m), speed (m/s|null) }. Returns an event or null. */
  add(p) {
    if (!p || !Number.isFinite(p.lat) || (p.acc != null && p.acc > 40)) return null;
    const prev = this.pts[this.pts.length - 1];
    if (prev && p.t - prev.t < 1500) return null;
    // altitude: smooth GPS noise
    if (Number.isFinite(p.alt)) this.alt = this.alt == null ? p.alt : this.alt + 0.35 * (p.alt - this.alt);
    let v = 0;
    if (prev) {
      const dt = (p.t - prev.t) / 1000, d = dist([prev.lat, prev.lon], [p.lat, p.lon]);
      v = Number.isFinite(p.speed) && p.speed >= 0 ? p.speed : d / dt;
      if (v > 40) return null; // >90 mph: GPS jump
    }
    const pt = { t: p.t, lat: p.lat, lon: p.lon, alt: this.alt, v: Math.round(v * 10) / 10 };
    this.pts.push(pt);
    this.start ??= p.t; this.last = p.t;
    if (this.alt != null) this.peakAlt = Math.max(this.peakAlt, this.alt);
    return this.classify(pt);
  }

  /** Vertical speed over the last ~40 s, horizontal speed over ~15 s. */
  motion() {
    const P = this.pts, n = P.length - 1, now = P[n];
    let i = n; while (i > 0 && now.t - P[i - 1].t <= 40000) i--;
    const a = P[i];
    const dt = (now.t - a.t) / 1000;
    const vz = dt > 8 && now.alt != null && a.alt != null ? (now.alt - a.alt) / dt : 0;
    let j = n; while (j > 0 && now.t - P[j - 1].t <= 15000) j--;
    let dh = 0; for (let k = j; k < n; k++) dh += dist([P[k].lat, P[k].lon], [P[k + 1].lat, P[k + 1].lon]);
    const vh = (now.t - P[j].t) > 0 ? dh / ((now.t - P[j].t) / 1000) : 0;
    return { vz, vh, dt };
  }

  classify(pt) {
    const { vz, vh, dt } = this.motion();
    if (dt < 8) return null;
    const nearLift = this.area ? nearestOf([pt.lat, pt.lon], this.area.lifts, 45) : null;
    let want;
    if (vz > 0.5 || (nearLift && vz > 0.25)) want = 'lift';
    else if (vz < -0.35 && vh > 2) want = 'run';
    else if (vh < 0.8 && Math.abs(vz) < 0.2) want = 'idle';
    else want = this.state; // ambiguous (traverse, slow cat track): keep current
    if (want !== this.state) {
      if (!this.pending || this.pending.s !== want) this.pending = { s: want, t: pt.t };
      if (pt.t - this.pending.t >= HOLD * 1000) return this.switchTo(want, this.pending.t);
      return null;
    }
    this.pending = null;
    return null;
  }

  switchTo(s, t) {
    let ev = null;
    if (this.seg) ev = this.close(this.seg, t);
    this.state = s; this.pending = null;
    this.seg = s === 'idle' ? null : { type: s, t0: t, i0: this.pts.findIndex((p) => p.t >= t) };
    return ev || { type: 'state', state: s };
  }

  close(seg, tEnd) {
    const P = this.pts.slice(Math.max(0, seg.i0), this.pts.findIndex((p) => p.t >= tEnd) + 1 || undefined);
    if (P.length < 3) return null;
    const alts = P.map((p) => p.alt).filter((a) => a != null);
    const drop = alts.length ? alts[0] - Math.min(...alts.slice(1)) : 0;
    const climb = alts.length ? Math.max(...alts) - alts[0] : 0;
    let d = 0, vmax = 0;
    for (let k = 0; k < P.length - 1; k++) d += dist([P[k].lat, P[k].lon], [P[k + 1].lat, P[k + 1].lon]);
    for (const p of P) vmax = Math.max(vmax, p.v || 0);
    const secs = (P[P.length - 1].t - P[0].t) / 1000;
    if (seg.type === 'run' && drop >= MIN_DROP) {
      const run = { t0: P[0].t, t1: P[P.length - 1].t, dropFt: Math.round(drop * M2FT), distMi: +(d / 1609.34).toFixed(2), secs: Math.round(secs),
        topMph: Math.round(vmax * MS2MPH), avgMph: +(secs ? (d / secs) * MS2MPH : 0).toFixed(1), ...this.runIdentity(P), rating: null };
      this.runs.push(run);
      this.topSpeed = Math.max(this.topSpeed, run.topMph);
      return { type: 'run', run };
    }
    if (seg.type === 'lift' && climb >= MIN_CLIMB) {
      const ride = { t0: P[0].t, t1: P[P.length - 1].t, climbFt: Math.round(climb * M2FT), secs: Math.round(secs), name: this.liftIdentity(P) };
      this.rides.push(ride);
      return { type: 'ride', ride };
    }
    return null;
  }

  /** Which mapped run (majority of points within 40 m), its difficulty and today's grooming. */
  runIdentity(P) {
    if (!this.area?.runs?.length) return { name: '', diff: '', groomed: null };
    const votes = new Map();
    for (let k = 0; k < P.length; k += 2) {
      const n = nearestOf([P[k].lat, P[k].lon], this.area.runs, 40);
      if (n && n.item.name) votes.set(n.item.name, (votes.get(n.item.name) || { n: 0, it: n.item })), votes.get(n.item.name).n++;
    }
    const top = [...votes.values()].sort((a, b) => b.n - a.n)[0];
    if (!top) return { name: '', diff: '', groomed: null };
    const fr = matchName(top.it.name, this.resortRuns, (x) => x.name, 0.7);
    return { name: top.it.name, diff: top.it.diff, groomed: fr ? fr.groomed : null };
  }

  liftIdentity(P) {
    if (!this.area?.lifts?.length) return '';
    const votes = new Map();
    for (let k = 0; k < P.length; k += 2) {
      const n = nearestOf([P[k].lat, P[k].lon], this.area.lifts, 60);
      if (n) votes.set(n.item.name, (votes.get(n.item.name) || 0) + 1);
    }
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  /** Close whatever segment is in progress (end of day). */
  finish() {
    if (this.seg && this.pts.length) { this.close(this.seg, this.pts[this.pts.length - 1].t + 1); this.seg = null; this.state = 'idle'; }
  }

  /** Lift currently being ridden (for recommendations), if any. */
  currentLift() {
    if (this.state !== 'lift' || !this.area) return null;
    const p = this.pts[this.pts.length - 1];
    const n = nearestOf([p.lat, p.lon], this.area.lifts, 60);
    return n ? { lift: n.item, frac: n.frac } : null;
  }

  stats() {
    const runs = this.runs, rides = this.rides;
    const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
    const skiSecs = sum(runs, (r) => r.secs), skiMi = sum(runs, (r) => r.distMi);
    const byDiff = {}; for (const r of runs) byDiff[r.diff || 'unknown'] = (byDiff[r.diff || 'unknown'] || 0) + 1;
    const liftCount = {}; for (const r of rides) if (r.name) liftCount[r.name] = (liftCount[r.name] || 0) + 1;
    const longest = runs.reduce((a, r) => (!a || r.distMi > a.distMi ? r : a), null);
    const biggest = runs.reduce((a, r) => (!a || r.dropFt > a.dropFt ? r : a), null);
    const rated = runs.filter((r) => r.rating);
    return {
      runs: runs.length, lifts: rides.length,
      vertFt: sum(runs, (r) => r.dropFt), climbFt: sum(rides, (r) => r.climbFt),
      skiMi: +skiMi.toFixed(1), topMph: this.topSpeed, avgMph: skiSecs ? +((skiMi / (skiSecs / 3600))).toFixed(1) : 0,
      skiMin: Math.round(skiSecs / 60), liftMin: Math.round(sum(rides, (r) => r.secs) / 60),
      dayMin: this.start ? Math.round((this.last - this.start) / 60000) : 0,
      peakFt: Number.isFinite(this.peakAlt) ? Math.round(this.peakAlt * M2FT) : null,
      longest, biggest, byDiff,
      favLift: Object.entries(liftCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
      groomedRuns: runs.filter((r) => r.groomed === true).length,
      avgRating: rated.length ? +(sum(rated, (r) => r.rating) / rated.length).toFixed(1) : null,
      vertPerHour: skiSecs + sum(rides, (r) => r.secs) > 0 ? Math.round(sum(runs, (r) => r.dropFt) / ((this.last - this.start) / 3600000 || 1)) : 0,
    };
  }
}
