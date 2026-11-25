// Per-device list of mountains + favorites (localStorage), and helpers to add new mountains.
import { RESORTS as DEFAULTS, slug } from './resorts.js';

const MTN_KEY = 'wp:mountains:v1';
const FAV_KEY = 'wp:favorites:v1';
const FT_PER_M = 3.28084;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Fields that come from the app's built-in resort config (refreshed on every load so saved lists pick up new features).
const CONFIG_FIELDS = ['liftie', 'opening', 'cams', 'camsUrl', 'trailMapUrl', 'site', 'snotel'];
export function getMountains() {
  const m = read(MTN_KEY);
  if (!Array.isArray(m)) return DEFAULTS.map((r) => ({ ...r }));
  return m.map((r) => {
    const d = DEFAULTS.find((x) => x.id === r.id);
    if (!d) return r;
    const fresh = { ...r };
    for (const k of CONFIG_FIELDS) if (d[k] !== undefined) fresh[k] = d[k];
    return fresh;
  });
}
export const hasSavedMountains = () => Array.isArray(read(MTN_KEY));
export function saveMountains(list) { write(MTN_KEY, list); }

export function getFavorites() {
  const f = read(FAV_KEY);
  return new Set(Array.isArray(f) ? f : DEFAULTS.map((r) => r.id));
}
export function saveFavorites(set) { write(FAV_KEY, [...set]); }

export function uniqueId(name, list) {
  const base = slug(name) || 'mountain';
  let id = base, n = 2;
  while (list.some((r) => r.id === id)) id = `${base}-${n++}`;
  return id;
}

/**
 * Estimate base & summit elevation from terrain data around a point
 * (Open-Meteo elevation API, ~90 m DEM): summit = highest sample within ~4 km,
 * base = the point itself, or the lowest nearby sample if the point sits near the top.
 */
export async function measureElevations(lat, lon) {
  const pts = [[lat, lon]];
  const kmLat = 1 / 111, kmLon = 1 / (111 * Math.cos((lat * Math.PI) / 180));
  for (const r of [1, 2, 3, 4]) {
    for (let a = 0; a < 8; a++) {
      const t = (a * Math.PI) / 4;
      pts.push([lat + Math.sin(t) * r * kmLat, lon + Math.cos(t) * r * kmLon]);
    }
  }
  const u = `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p[0].toFixed(5)).join(',')}&longitude=${pts.map((p) => p[1].toFixed(5)).join(',')}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`elevation ${res.status}`);
  const el = (await res.json()).elevation || [];
  if (!el.length || !Number.isFinite(el[0])) throw new Error('no elevation data');
  const center = el[0];
  const summit = Math.max(...el.filter(Number.isFinite));
  const near = el.slice(0, 17).filter(Number.isFinite); // within 2 km
  let base = center;
  if (summit - center < 150) base = Math.min(...near);
  if (summit - base < 100) base = summit - 100;
  return { baseFt: Math.round(base * FT_PER_M), summitFt: Math.round(summit * FT_PER_M) };
}

/** Search any place worldwide (Open-Meteo geocoding, GeoNames data). */
export async function searchPlaces(q) {
  const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json`;
  const res = await fetch(u);
  if (!res.ok) return [];
  const j = await res.json();
  return (j.results || []).map((p) => ({
    name: p.name,
    state: p.admin1 || '',
    country: p.country_code === 'US' ? 'USA' : p.country || '',
    lat: p.latitude,
    lon: p.longitude,
    kind: p.feature_code,
  }));
}

/** Nearest SNOTEL station (US only) via our API; null if none within range. */
export async function nearestSnotel(lat, lon) {
  try {
    const res = await fetch(`/api/snotel-near?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const j = await res.json();
    return j.triplet ? { triplet: j.triplet, name: j.name } : null;
  } catch { return null; }
}
