// Live lift status from Liftie (liftie.info, open source), which reads each resort's own lift-status feed.
// Pass ?id=<liftie id>, or ?lat=&lon=&name= to find the nearest Liftie resort (within 15 km).
const BASE = 'https://liftie.info';
let metaCache = null;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'WhitePowder/1.0 (personal ski app)', accept: 'application/json' } });
    const body = await r.text();
    if (!r.ok) throw new Error(`Liftie ${r.status}: ${body.slice(0, 120)}`);
    try { return JSON.parse(body); } catch { throw new Error(`Liftie non-JSON: ${body.slice(0, 120)}`); }
  } finally { clearTimeout(t); }
}

function km(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function findId(lat, lon, name) {
  if (!metaCache || Date.now() - metaCache.at > 864e5) metaCache = { at: Date.now(), list: await getJson(`${BASE}/api/meta`) };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = null;
  for (const m of metaCache.list || []) {
    if (!Array.isArray(m.ll)) continue;
    const d = km(lat, lon, m.ll[1], m.ll[0]);
    const nameHit = name && (norm(m.name).includes(norm(name)) || norm(name).includes(norm(m.name)));
    const score = d - (nameHit ? 10 : 0);
    if (d <= 15 && (!best || score < best.score)) best = { id: m.id, score };
  }
  return best?.id || null;
}

export function summarize(j) {
  const status = j?.lifts?.status || {};
  const stats = j?.lifts?.stats || {};
  const names = (s) => Object.entries(status).filter(([, v]) => v === s).map(([k]) => k);
  const resortUrl = j?.url ? (typeof j.url === 'string' ? j.url : `${j.url.host || ''}${j.url.pathname || ''}`) : null;
  return {
    name: j?.name || null,
    url: resortUrl,
    open: stats.open || 0,
    hold: stats.hold || 0,
    scheduled: stats.scheduled || 0,
    closed: stats.closed || 0,
    total: Object.keys(status).length,
    holdLifts: names('hold').slice(0, 8),
    opening: typeof j?.opening === 'string' ? j.opening : null,
  };
}

export default async function handler(req, res) {
  try {
    let id = String(req.query.id || '').replace(/[^a-z0-9-]/gi, '');
    if (!id) {
      const lat = Number(req.query.lat), lon = Number(req.query.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'id or lat/lon required' });
      id = await findId(lat, lon, req.query.name);
      if (!id) {
        res.setHeader('Cache-Control', 's-maxage=86400');
        return res.status(200).json({ found: false });
      }
    }
    const j = await getJson(`${BASE}/api/resort/${encodeURIComponent(id)}`);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ found: true, id, ...summarize(j), source: 'Liftie (liftie.info)', fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(req.query.debug ? 200 : 502).json({ error: e.message || String(e), cause: String(e.cause?.code || e.cause || '') });
  }
}
