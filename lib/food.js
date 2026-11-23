// Restaurants/cafés/bars near a mountain from OpenStreetMap (Overpass), split into slopeside vs town.
// One query returns the mapped ski-area outline (landuse=winter_sports) plus named eateries;
// "slopeside" = inside that outline or within 600 m of the resort point.
export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const AMENITY = '^(restaurant|cafe|bar|pub|fast_food)$';

export function foodQuery(lat, lon, radius = 10000) {
  return `[out:json][timeout:25];
(way["landuse"="winter_sports"](around:2500,${lat},${lon});relation["landuse"="winter_sports"](around:2500,${lat},${lon}););
out bb tags;
nwr["amenity"~"${AMENITY}"]["name"](around:${radius},${lat},${lon});
out center tags 250;`;
}

/** Ask every Overpass mirror at once and take the first good answer (public servers are often busy). */
export async function fetchOverpass(q, { timeoutMs = 15000, headers = {}, log } = {}) {
  const ctrls = [];
  const one = async (url) => {
    const host = new URL(url).host;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctrl) ctrls.push(ctrl);
    const t = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: `data=${encodeURIComponent(q)}`,
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
      if (!r.ok) throw new Error(`${host} ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j.elements) || (j.remark && /error|timed out|rate/i.test(j.remark) && !j.elements.length)) throw new Error(`${host}: ${String(j.remark || 'bad response').slice(0, 120)}`);
      return j.elements;
    } catch (e) {
      const err = e.name === 'AbortError' ? new Error(`${host} timed out`) : e;
      log?.push(String(err.message || err));
      throw err;
    } finally { if (t) clearTimeout(t); }
  };
  try {
    const els = await Promise.any(OVERPASS.map(one));
    ctrls.forEach((c) => { try { c.abort(); } catch {} });
    return els;
  } catch (agg) {
    throw new Error((agg.errors || [agg]).map((e) => e.message).join('; '));
  }
}

function km(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Ski-area outlines as rings ([[lat,lon],...]): full geometry when present, else the bounding box from `out bb`. */
export function skiRings(elements) {
  const rings = [];
  const closed = (g) => g && g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  for (const e of elements) {
    if (e.tags?.landuse !== 'winter_sports') continue;
    if (e.type === 'way' && closed(e.geometry)) { rings.push(e.geometry.map((p) => [p.lat, p.lon])); continue; }
    const b = e.bounds;
    if (b) rings.push([[b.minlat, b.minlon], [b.minlat, b.maxlon], [b.maxlat, b.maxlon], [b.maxlat, b.minlon], [b.minlat, b.minlon]]);
  }
  return rings;
}

export function inRing([y, x], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function shape(el, lat, lon) {
  const t = el.tags || {};
  const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
  if (!t.name || !t.amenity || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return {
    id: `${el.type}/${el.id}`,
    name: t.name,
    kind: t.amenity,
    cuisine: (t.cuisine || '').split(';').map((c) => c.replace(/_/g, ' ').trim()).filter(Boolean).slice(0, 2).join(', '),
    hours: t.opening_hours || '',
    website: t.website || t['contact:website'] || '',
    lat: la, lon: lo,
    distKm: Math.round(km(lat, lon, la, lo) * 10) / 10,
  };
}

export function buildFood(elements, lat, lon) {
  const rings = skiRings(elements);
  const seen = new Set();
  const slopeside = [], town = [];
  for (const el of elements) {
    const p = shape(el, lat, lon);
    if (!p) continue;
    const key = `${p.name.toLowerCase()}|${Math.round(p.lat * 1000)}|${Math.round(p.lon * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const onMtn = rings.length ? (p.distKm <= 0.6 || rings.some((r) => inRing([p.lat, p.lon], r))) : p.distKm <= 2;
    (onMtn ? slopeside : town).push(p);
  }
  slopeside.sort((a, b) => a.distKm - b.distKm);
  town.sort((a, b) => a.distKm - b.distKm);
  return { slopeside: slopeside.slice(0, 30), town: town.slice(0, 40), skiAreaMapped: rings.length > 0 };
}

// ---- Nominatim (OpenStreetMap place search): reliable fallback when Overpass servers are overloaded ----
export const NOMINATIM_KINDS = ['restaurant', 'cafe', 'bar', 'pub', 'fast food'];

export function nominatimUrl(kind, lat, lon, radiusKm = 9) {
  const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const p = new URLSearchParams({
    q: kind, format: 'jsonv2', limit: '40', bounded: '1', extratags: '1',
    viewbox: `${(lon - dLon).toFixed(4)},${(lat + dLat).toFixed(4)},${(lon + dLon).toFixed(4)},${(lat - dLat).toFixed(4)}`,
  });
  return `https://nominatim.openstreetmap.org/search?${p}`;
}

/** Convert Nominatim jsonv2 results to the same element shape Overpass returns, so buildFood() works on both. */
export function nominatimToElements(results) {
  return (Array.isArray(results) ? results : [])
    .filter((r) => (r.category === 'amenity' || r.class === 'amenity') && r.name)
    .map((r) => ({
      type: r.osm_type || 'node',
      id: r.osm_id || r.place_id,
      lat: Number(r.lat),
      lon: Number(r.lon),
      tags: {
        name: r.name,
        amenity: r.type,
        cuisine: r.extratags?.cuisine || '',
        opening_hours: r.extratags?.opening_hours || '',
        website: r.extratags?.website || r.extratags?.['contact:website'] || '',
      },
    }));
}
