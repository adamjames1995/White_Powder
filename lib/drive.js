// First Tracks: pure logic for drive advice (chain rules, leave time, pack list, map links). Testable without the DOM.
import { dist } from './skiarea.js';

export const VEHICLE_DEFAULT = { drive: 'awd', tires: 'allseason', chains: true };
const isAwd = (v) => v.drive === 'awd' || v.drive === '4wd';
const snowTires = (v) => v.tires === 'snow';

/** Caltrans chain control level from a status like "R-2" / "R2" / text. 0 = none. */
export function chainLevel(status, text = '') {
  const m = String(status || '').match(/R\s*-?\s*([0-3])/i) || String(text).match(/\bR\s*-?\s*([0-3])\b/);
  if (m) return Number(m[1]);
  if (/no chain/i.test(text)) return 0;
  if (/chains? (are )?required/i.test(text)) return 2;
  return 0;
}

/** What a Caltrans R-level means for this vehicle. */
export function chainAdvice(level, v) {
  if (!level) return { ok: true, text: 'No chain controls' };
  if (level === 1) {
    const ok = isAwd(v) || snowTires(v);
    return { ok, text: ok ? 'R1 — you can pass (AWD/4WD or snow tires). Carry chains.' : 'R1 — install chains or traction devices on your drive wheels.' };
  }
  if (level === 2) {
    const ok = isAwd(v) && snowTires(v);
    return { ok, text: ok ? 'R2 — AWD/4WD with snow tires on all four can pass. Chains must be in the car.' : `R2 — chains required for your ${v.drive.toUpperCase()}${snowTires(v) ? '' : ' without snow tires'}.` };
  }
  return { ok: false, text: 'R3 — chains on every vehicle, no exceptions. Road may close.' };
}

/** WSDOT pass message → advice for this vehicle. */
export function passAdvice(text, v) {
  const t = String(text || '');
  if (!t || /no restrictions/i.test(t)) return { ok: true, text: t || 'No restrictions' };
  if (/pass closed|closed/i.test(t) && !/lane/i.test(t)) return { ok: false, text: t };
  if (/chains required/i.test(t)) {
    const exceptAwd = /except all wheel drive|except.*(all|four)[- ]wheel/i.test(t);
    return { ok: exceptAwd && isAwd(v), text: t };
  }
  if (/traction tires required/i.test(t)) return { ok: snowTires(v), text: t };
  return { ok: true, text: t };
}

const H = 3600e3, M = 60e3;
export const fmtClock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const fmtDur = (min) => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; };

/**
 * Pick a departure time.
 * ctx: { dayStart (ms, local midnight), firstChair "HH:MM", baseMin, times:[{depart ISO, min, delayMin}],
 *        samples:[{frac, elevFt, name, hourly:{t:[ms], snow:[in/hr], temp:[F], code:[]}}],
 *        chainLevelMax, now (ms) }
 * Returns { leave, arrive, driveMin, trafficMin, weatherMin, reasons[], storm, candidates[] }.
 */
export const GOALS = {
  chair: { label: 'First chair', short: 'First chair' },
  parking: { label: 'Secure parking', short: 'Parking' },
  weather: { label: 'Avoid weather', short: 'Weather' },
  traffic: { label: 'Beat traffic', short: 'Traffic' },
};
// How each goal trades off arriving on time vs early, traffic and snow on the road.
const GOAL_W = {
  chair: { lead: 30, late: 4, early: 0.6, wx: 1.5, tr: 0.8 },
  parking: { lead: 75, late: 5, early: 0.4, wx: 1.2, tr: 0.6 },
  weather: { lead: 30, late: 0.7, early: 0.15, wx: 7, tr: 0.5 },
  traffic: { lead: 30, late: 1.6, early: 0.25, wx: 1.2, tr: 4 },
};

export function pickLeave(ctx) {
  const [h, m] = String(ctx.firstChair || '09:00').split(':').map(Number);
  const chair = ctx.dayStart + h * H + m * M;
  const goal = GOAL_W[ctx.goal] ? ctx.goal : 'chair';
  const W = GOAL_W[goal];
  const weekend = [0, 6].includes(new Date(ctx.dayStart).getDay());
  const lead = goal === 'parking' && (weekend || ctx.powderDay) ? 95 : W.lead;
  const target = chair - lead * M; // time to park and boot up
  const base = ctx.baseMin;
  const traffic = (dep) => {
    const T = (ctx.times || []).map((x) => ({ t: Date.parse(x.depart), min: x.min, delay: x.delayMin || 0 })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
    if (!T.length) return { min: base, delay: 0 };
    if (dep <= T[0].t) return T[0];
    if (dep >= T[T.length - 1].t) return T[T.length - 1];
    for (let i = 0; i < T.length - 1; i++) if (dep >= T[i].t && dep <= T[i + 1].t) {
      const f = (dep - T[i].t) / (T[i + 1].t - T[i].t);
      return { min: T[i].min + f * (T[i + 1].min - T[i].min), delay: T[i].delay + f * (T[i + 1].delay - T[i].delay) };
    }
    return { min: base, delay: 0 };
  };
  const weatherAt = (dep, min) => {
    let add = 0; const hits = [];
    for (const s of ctx.samples || []) {
      const eta = dep + s.frac * min * M;
      const i = s.hourly.t.findIndex((t) => t > eta) - 1;
      if (i < 0) continue;
      const snow = s.hourly.snow[i] || 0, temp = s.hourly.temp[i];
      if (snow >= 0.5) { add += 12; hits.push({ name: s.name, snow, eta, heavy: true }); }
      else if (snow >= 0.15) { add += 5; hits.push({ name: s.name, snow, eta }); }
      else if (temp != null && temp <= 32 && (s.hourly.precip?.[i] || 0) > 0.01) add += 3;
    }
    return { add: Math.min(add, 60), hits };
  };
  const chainAdd = ({ 1: 10, 2: 25, 3: 45 })[ctx.chainLevelMax || 0] || 0;
  const cands = [];
  const earliest = Math.max(ctx.dayStart + 3.5 * H, (ctx.now || 0) + 5 * M);
  const lastStart = target - base * M + (goal === 'weather' ? 150 : goal === 'traffic' ? 90 : 45) * M;
  for (let dep = Math.ceil((target - base * M - 240 * M) / (15 * M)) * 15 * M; dep <= lastStart; dep += 15 * M) {
    if (dep < earliest) continue;
    const tr = traffic(dep);
    const w = weatherAt(dep, tr.min);
    const drive = tr.min + w.add + chainAdd;
    const arrive = dep + drive * M;
    const late = Math.max(0, arrive - target) / M, early = Math.max(0, target - arrive) / M;
    const score = late * W.late + early * W.early + w.add * W.wx + tr.delay * W.tr;
    cands.push({ dep, arrive, drive, traffic: tr.delay, weather: w.add, hits: w.hits, score });
  }
  if (!cands.length) { // already past the window (e.g. it's 10 AM on the day): leave now
    const dep = Math.max(ctx.now || ctx.dayStart, ctx.dayStart + 3.5 * H), tr = traffic(dep), w = weatherAt(dep, tr.min);
    const drive = tr.min + w.add + chainAdd;
    cands.push({ dep, arrive: dep + drive * M, drive, traffic: tr.delay, weather: w.add, hits: w.hits, score: 0, late: true });
  }
  const best = cands.reduce((a, c) => (c.score < a.score ? c : a));
  const reasons = [];
  const before = Math.round((chair - best.arrive) / M);
  reasons.push(`${fmtDur(best.drive)} drive → arrive ~${fmtClock(best.arrive)}, ${before >= 0 ? `${before} min before` : `${-before} min after`} first chair (${fmtClock(chair)})`);
  if (goal === 'parking') reasons.push(`Aims to park ~${lead} min early${lead > 75 ? ' (weekend / powder day — lots fill fast)' : ''}`);
  if (goal === 'weather' && !best.weather) reasons.push('Times your drive to miss the snow on the passes');
  if (goal === 'traffic') reasons.push(best.traffic < 3 ? 'Little to no traffic at this hour' : `Lightest traffic window (~${Math.round(best.traffic)} min delay)`);
  if (best.traffic >= 5) reasons.push(`Includes ~${Math.round(best.traffic)} min of expected traffic`);
  const worst = cands.reduce((a, c) => (c.traffic > a.traffic ? c : a));
  if (worst.traffic - best.traffic >= 15) reasons.push(`Leaving at ${fmtClock(worst.dep)} instead would add ~${Math.round(worst.traffic - best.traffic)} min of traffic`);
  if (best.weather) reasons.push(`Snow on the road adds ~${Math.round(best.weather)} min${best.hits[0] ? ` (${best.hits[0].name})` : ''}`);
  if (chainAdd) reasons.push(`Chain controls add ~${chainAdd} min`);
  // storm on the drive: heaviest hourly snow near the passes during the morning
  const storm = stormWindow(ctx.samples, ctx.dayStart);
  if (storm) {
    if (storm.start > best.dep + best.drive * M) reasons.push(`Snow starts ~${fmtClock(storm.start)} on the pass — you'll be over before it`);
    else if (storm.end < best.dep) reasons.push(`Overnight snow ends ~${fmtClock(storm.end)}; plows will be catching up`);
    else reasons.push(`You'll drive through snow (${storm.peak.toFixed(1)}"/hr at ${storm.name}) — leave extra time`);
  }
  return { goal, leave: best.dep, arrive: best.arrive, driveMin: best.drive, trafficMin: best.traffic, weatherMin: best.weather, reasons, storm, chair, late: !!best.late };
}

/** When heavy-ish snow (≥0.2"/hr) falls on the highest route points between 2 AM and noon. */
export function stormWindow(samples, dayStart) {
  const hi = [...(samples || [])].sort((a, b) => (b.elevFt || 0) - (a.elevFt || 0)).slice(0, 3);
  let start = null, end = null, peak = 0, name = '';
  for (const s of hi) s.hourly.t.forEach((t, i) => {
    if (t < dayStart + 2 * H || t > dayStart + 12 * H) return;
    const v = s.hourly.snow[i] || 0;
    if (v >= 0.2) { start = start == null ? t : Math.min(start, t); end = end == null ? t + H : Math.max(end, t + H); if (v > peak) { peak = v; name = s.name; } }
  });
  return start == null ? null : { start, end, peak, name };
}

/** Powder day pick over the next few mornings: overnight snow at the resort vs snow on the road during the drive. */
export function powderPick(resortHourly, samples, days = 4, now = Date.now()) {
  const out = [];
  const midnight = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  for (let k = 0; k < days; k++) {
    const day = midnight(now) + k * 24 * H;
    const sum = (h, from, to) => h.t.reduce((a, t, i) => (t >= from && t < to ? a + (h.snow[i] || 0) : a), 0);
    const overnight = resortHourly ? sum(resortHourly, day - 8 * H, day + 7 * H) : 0;
    const road = Math.max(0, ...(samples || []).map((s) => sum(s.hourly, day + 4 * H, day + 9 * H)));
    out.push({ day, overnight, road, score: overnight - road * 1.5 });
  }
  const best = out.reduce((a, c) => (c.score > a.score ? c : a), out[0]);
  return { days: out, best: best && best.overnight >= 2 ? best : null };
}

/** Pack list for this trip. */
export function packList({ v, chainMax = 0, snowOnRoad = 0, minTemp = 40, bc = false, wa = false }) {
  const items = [];
  const needChains = chainMax >= 1 || snowOnRoad >= 1;
  if (!v.chains && (needChains || wa || chainMax >= 0)) items.push({ k: 'chains', t: needChains ? 'Chains or cables — buy/rent before you go (required in chain controls)' : 'Chains or cables in the trunk (Caltrans/WSDOT can require them)', must: needChains });
  else if (v.chains) items.push({ k: 'chains', t: 'Chains are in the car — gloves + a kneeling pad make install easier', must: chainMax >= 2 });
  if (bc && v.tires !== 'snow') items.push({ k: 'bctires', t: 'BC requires winter tires (M+S or mountain/snowflake) on Hwy 99 Oct 1 – Apr 30', must: true });
  if (v.tires !== 'snow' && snowOnRoad >= 2) items.push({ k: 'tires', t: 'Snow on the route — snow tires would help a lot', must: false });
  items.push({ k: 'fuel', t: 'Full tank (or 80%+ charge) — traffic in snow burns more', must: snowOnRoad >= 1 || chainMax >= 1 });
  items.push({ k: 'scraper', t: 'Ice scraper + snow brush', must: minTemp <= 32 });
  items.push({ k: 'washer', t: 'Winter washer fluid (rated below 0°F)', must: minTemp <= 25 });
  if (snowOnRoad >= 3) items.push({ k: 'shovel', t: 'Small shovel + traction mats', must: false });
  items.push({ k: 'warm', t: 'Warm layers, blanket, water and snacks', must: false });
  items.push({ k: 'charger', t: 'Phone charger + headlamp', must: false });
  return items;
}

/** Evenly spaced sample points along a route, plus the destination. */
export function sampleRoute(coords, everyKm = 20) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += dist(coords[i - 1], coords[i]);
  const out = []; let acc = 0, run = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = dist(coords[i - 1], coords[i]); acc += d; run += d;
    if (acc >= everyKm * 1000) { out.push({ lat: coords[i][0], lon: coords[i][1], frac: run / total }); acc = 0; }
  }
  const end = coords[coords.length - 1];
  out.push({ lat: end[0], lon: end[1], frac: 1 });
  return out.length > 24 ? out.filter((_, k) => k % Math.ceil(out.length / 24) === 0 || k === out.length - 1) : out;
}

/** Google Maps link that follows this exact route (a few via points). Apple Maps takes start/end only. */
export function googleMapsUrl(from, toName, to, coords) {
  const vias = [0.25, 0.5, 0.75].map((f) => coords[Math.floor(f * (coords.length - 1))]).map(([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`);
  const q = new URLSearchParams({ api: '1', origin: `${from[0]},${from[1]}`, destination: to ? `${to[0]},${to[1]}` : toName, travelmode: 'driving', waypoints: vias.join('|') });
  return `https://www.google.com/maps/dir/?${q}`;
}
export const appleMapsUrl = (from, toName, to) => `https://maps.apple.com/?saddr=${from[0]},${from[1]}&daddr=${to ? `${to[0]},${to[1]}` : encodeURIComponent(toName)}&dirflg=d`;
