// Ski-area geometry (lifts + runs) from OpenStreetMap via Overpass, cached on the phone.
import { OVERPASS } from './food.js';

const KEY = 'wp:skiarea:v1:';
const TTL = 14 * 24 * 3600 * 1000;

const DIFF = { novice: 'green', easy: 'green', intermediate: 'blue', advanced: 'black', expert: 'expert', freeride: 'expert', extreme: 'expert' };
export const diffOf = (osm) => DIFF[String(osm || '').toLowerCase()] || 'blue';

export function overpassQuery(lat, lon, radius = 5000) {
  return `[out:json][timeout:25];(way["aerialway"](around:${radius},${lat},${lon});way["piste:type"="downhill"](around:${radius},${lat},${lon}););out geom tags;`;
}

/** Overpass elements → compact area { lifts:[{name,type,coords}], runs:[{name,diff,groomingTag,coords}] }. First node of a lift is its bottom. */
export function buildArea(elements) {
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const lifts = [], runs = [];
  for (const e of elements || []) {
    if (e.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
    const t = e.tags || {};
    const coords = e.geometry.map((g) => [r5(g.lat), r5(g.lon)]);
    if (t.aerialway && !/^(station|pylon|goods|zip_line)$/.test(t.aerialway)) {
      lifts.push({ id: e.id, name: t.name || t.ref || `${t.aerialway.replace(/_/g, ' ')}`, type: t.aerialway, coords });
    } else if (t['piste:type'] === 'downhill') {
      runs.push({ id: e.id, name: t['piste:name'] || t.name || '', diff: diffOf(t['piste:difficulty']), groomTag: t['piste:grooming'] || '', coords });
    }
  }
  return { lifts, runs, at: Date.now() };
}

export async function loadSkiArea(id, lat, lon) {
  try {
    const c = JSON.parse(localStorage.getItem(KEY + id) || 'null');
    if (c && Date.now() - c.at < TTL && (c.lifts.length || c.runs.length)) return c;
  } catch {}
  const q = overpassQuery(lat, lon);
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`${r.status}`);
      const area = buildArea((await r.json()).elements);
      try { localStorage.setItem(KEY + id, JSON.stringify(area)); } catch {}
      return area;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('ski area map unavailable');
}

// ---------- geometry helpers ----------
const R = 6371000, rad = Math.PI / 180;
export function dist(a, b) { // [lat,lon] → metres
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/** Distance from point p to a polyline (metres), with the fraction along the line of the closest point. */
export function distToLine(p, coords) {
  let best = Infinity, frac = 0, total = 0;
  const segs = [];
  for (let i = 0; i < coords.length - 1; i++) { const d = dist(coords[i], coords[i + 1]); segs.push(d); total += d; }
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    // local equirectangular projection
    const kx = Math.cos(a[0] * rad) * R * rad, ky = R * rad;
    const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * ky, px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * ky;
    const L2 = bx * bx + by * by;
    const t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best) { best = d; frac = total ? (acc + t * segs[i]) / total : 0; }
    acc += segs[i];
  }
  return { d: best, frac };
}
export const nearestOf = (p, items, maxD = Infinity) => {
  let best = null;
  for (const it of items) { const { d, frac } = distToLine(p, it.coords); if (d < maxD && (!best || d < best.d)) best = { item: it, d, frac }; }
  return best;
};

// Lift names differ between the resort feed ("#6 Cornice Express") and the map ("Cornice"). Match loosely.
const STOP = new Set(['the', 'express', 'chair', 'chairlift', 'lift', 'quad', 'triple', 'double', 'six', 'pack', 'high', 'speed', 'detachable', 'hsq', 'to', 'lower', 'upper']);
export const tokens = (s) => String(s || '').toLowerCase().replace(/#\s*\d+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
export function nameScore(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  const sb = new Set(B); const inter = A.filter((w) => sb.has(w)).length;
  return inter / Math.min(A.length, B.length);
}
export function matchName(name, candidates, key = (x) => x.name, min = 0.6) {
  let best = null, bs = 0;
  for (const c of candidates) { const s = nameScore(name, key(c)); if (s > bs) { bs = s; best = c; } }
  return bs >= min ? best : null;
}
