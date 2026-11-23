// Official (published) trail map images for a mountain via Skimap.org, the community archive of
// resort trail maps. Finds the nearest Skimap.org ski area, then lists its maps (newest first).
const HEADERS = { 'user-agent': 'WhitePowder/1.0 (personal ski forecast app)', referer: 'https://whitepowderapp2.vercel.app', accept: 'application/json' };
let index = null;

async function getJSON(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${new URL(url).pathname} → ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function km(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(ski|resort|area|mountain|mtn|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Nearest Skimap.org ski area to a point, preferring a name match within 15 km. */
export function pickArea(features, lat, lon, name) {
  const want = norm(name);
  let best = null;
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const d = km(lat, lon, c[1], c[0]);
    if (d > 15) continue;
    const n = norm(f.properties?.name);
    const nameHit = want && n && (n.includes(want) || want.includes(n));
    const score = d - (nameHit ? 10 : 0);
    if (!best || score < best.score) best = { id: String(f.properties?.id), name: f.properties?.name, distKm: d, score };
  }
  return best;
}

/** Pull map images out of a Skimap.org ski-area record, whatever its exact shape. */
export function extractMaps(record) {
  const maps = [];
  const list = record?.ski_maps || record?.skiMaps || record?.maps || [];
  for (const m of Array.isArray(list) ? list : []) {
    const urls = [];
    (function walk(o) {
      if (!o) return;
      if (typeof o === 'string') { if (/^https?:\/\/.+\.(jpe?g|png|webp|gif|pdf)(\?.*)?$/i.test(o)) urls.push(o); return; }
      if (typeof o === 'object') Object.values(o).forEach(walk);
    })(m);
    const images = urls.filter((u) => !/\.pdf/i.test(u));
    if (!images.length && !urls.length) continue;
    const pick = (re) => images.find((u) => re.test(u));
    maps.push({
      id: m.id,
      year: Number(m.year_published || m.year || m.published) || null,
      image: pick(/(large|full|original)/i) || images.sort((a, b) => b.length - a.length)[0] || null,
      thumb: pick(/(thumb|small|medium)/i) || images[0] || null,
      pdf: urls.find((u) => /\.pdf/i.test(u)) || null,
      page: m.id ? `https://skimap.org/SkiMaps/view/${m.id}` : null,
    });
  }
  return maps.sort((a, b) => (b.year || 0) - (a.year || 0));
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon), name = String(req.query.name || '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  try {
    if (!index || Date.now() - index.at > 7 * 864e5) {
      const gj = await getJSON('https://skimap.org/SkiAreas/index.geojson', 25000);
      index = { at: Date.now(), features: gj.features || [] };
    }
    const area = pickArea(index.features, lat, lon, name);
    if (!area) return res.status(200).json({ maps: [], note: 'No Skimap.org ski area within 15 km' });
    const rec = await getJSON(`https://skimap.org/SkiAreas/view/${area.id}.json`);
    const maps = extractMaps(rec).slice(0, 8);
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=2592000');
    res.status(200).json({ area: { id: area.id, name: area.name, url: `https://skimap.org/SkiAreas/view/${area.id}` }, maps, ...(req.query.debug ? { keys: Object.keys(rec || {}), sample: JSON.stringify(rec?.ski_maps?.[0] || rec).slice(0, 600) } : {}) });
  } catch (e) {
    res.status(req.query.debug ? 200 : 502).json({ error: e.message, maps: [] });
  }
}
