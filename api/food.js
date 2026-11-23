// Restaurants, cafés and bars near a mountain from OpenStreetMap (Overpass API).
// "Slopeside" = inside the mapped ski area (landuse=winter_sports) or within 600 m of the resort point.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const AMENITY = '^(restaurant|cafe|bar|pub|fast_food)$';

async function overpass(q) {
  let last;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'WhitePowder/1.0 (personal ski forecast app)' },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      return (await r.json()).elements || [];
    } catch (e) { last = e; }
  }
  throw last;
}

function km(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function shape(el, lat, lon) {
  const t = el.tags || {};
  const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
  if (!t.name || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return {
    id: `${el.type}/${el.id}`,
    name: t.name,
    kind: t.amenity,
    cuisine: (t.cuisine || '').split(';').map((c) => c.replace(/_/g, ' ')).filter(Boolean).slice(0, 2).join(', '),
    hours: t.opening_hours || '',
    website: t.website || t['contact:website'] || '',
    phone: t.phone || t['contact:phone'] || '',
    lat: la, lon: lo,
    distKm: Math.round(km(lat, lon, la, lo) * 10) / 10,
  };
}

export function split(onIds, all, lat, lon) {
  const seen = new Set();
  const slope = [], town = [];
  for (const el of all) {
    const p = shape(el, lat, lon);
    if (!p) continue;
    const key = `${p.name.toLowerCase()}|${Math.round(p.lat * 1000)}|${Math.round(p.lon * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (onIds.has(p.id) || p.distKm <= 0.6 ? slope : town).push(p);
  }
  slope.sort((a, b) => a.distKm - b.distKm);
  town.sort((a, b) => a.distKm - b.distKm);
  return { slopeside: slope.slice(0, 30), town: town.slice(0, 40) };
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  const radius = Math.min(20000, Number(req.query.radius) || 12000);
  const onQ = `[out:json][timeout:25];
(way["landuse"="winter_sports"](around:2500,${lat},${lon});relation["landuse"="winter_sports"](around:2500,${lat},${lon}););
map_to_area->.a;
nwr(area.a)["amenity"~"${AMENITY}"]["name"];
out center tags 80;`;
  const allQ = `[out:json][timeout:25];
nwr["amenity"~"${AMENITY}"]["name"](around:${radius},${lat},${lon});
out center tags 300;`;
  try {
    const [on, all] = await Promise.all([overpass(onQ).catch(() => []), overpass(allQ)]);
    const onIds = new Set(on.map((e) => `${e.type}/${e.id}`));
    const out = split(onIds, [...on, ...all], lat, lon);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ...out, skiAreaMapped: on.length > 0, source: 'OpenStreetMap contributors' });
  } catch (e) {
    res.status(502).json({ error: e.message, slopeside: [], town: [] });
  }
}
