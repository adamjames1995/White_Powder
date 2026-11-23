// Restaurants/cafés/bars near a mountain from OpenStreetMap (Overpass), split into slopeside vs town.
// One query returns the mapped ski-area outline (landuse=winter_sports) plus named eateries;
// "slopeside" = inside that outline or within 600 m of the resort point.
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const AMENITY = '^(restaurant|cafe|bar|pub|fast_food)$';

export function foodQuery(lat, lon, radius = 10000) {
  return `[out:json][timeout:25];
(way["landuse"="winter_sports"](around:2500,${lat},${lon});relation["landuse"="winter_sports"](around:2500,${lat},${lon}););
out geom;
nwr["amenity"~"${AMENITY}"]["name"](around:${radius},${lat},${lon});
out center tags 250;`;
}

export async function fetchOverpass(q, { timeoutMs = 30000 } = {}) {
  let last;
  for (const url of OVERPASS) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      return (await r.json()).elements || [];
    } catch (e) { last = e.name === 'AbortError' ? new Error('Overpass timed out') : e; }
    finally { if (t) clearTimeout(t); }
  }
  throw last;
}

function km(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Closed rings ([[lat,lon],...]) from ski-area ways/relations returned with `out geom`. */
export function skiRings(elements) {
  const rings = [];
  const closed = (g) => g && g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  for (const e of elements) {
    if (e.tags?.landuse !== 'winter_sports') continue;
    if (e.type === 'way' && closed(e.geometry)) rings.push(e.geometry.map((p) => [p.lat, p.lon]));
    if (e.type === 'relation') {
      for (const m of e.members || []) if (m.role !== 'inner' && closed(m.geometry)) rings.push(m.geometry.map((p) => [p.lat, p.lon]));
    }
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
    const onMtn = p.distKm <= 0.6 || rings.some((r) => inRing([p.lat, p.lon], r));
    (onMtn ? slopeside : town).push(p);
  }
  slopeside.sort((a, b) => a.distKm - b.distKm);
  town.sort((a, b) => a.distKm - b.distKm);
  return { slopeside: slopeside.slice(0, 30), town: town.slice(0, 40), skiAreaMapped: rings.length > 0 };
}
