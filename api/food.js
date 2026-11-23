// Server fallback for the food lookup (the app normally queries Overpass directly from the phone).
import { foodQuery, fetchOverpass, buildFood } from '../lib/food.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.query.ping) { // quick health check of each Overpass mirror from this server
    const { OVERPASS } = await import('../lib/food.js');
    const out = await Promise.all(OVERPASS.map(async (url) => {
      const t0 = Date.now();
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'WhitePowder/1.0' }, body: 'data=' + encodeURIComponent('[out:json][timeout:5];node(1);out;') });
        return { url, status: r.status, ms: Date.now() - t0, body: (await r.text()).slice(0, 80) };
      } catch (e) { return { url, error: e.name === 'AbortError' ? 'timeout 8s' : e.message, ms: Date.now() - t0 }; }
      finally { clearTimeout(to); }
    }));
    return res.status(200).json(out);
  }
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  const log = [];
  try {
    const els = await fetchOverpass(foodQuery(lat, lon), { timeoutMs: 20000, log, headers: { 'user-agent': 'WhitePowder/1.0 (personal ski forecast app; https://github.com/adamjames1995/White_Powder)' } });
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ...buildFood(els, lat, lon), source: 'OpenStreetMap contributors' });
  } catch (e) {
    res.status(req.query.debug ? 200 : 502).json({ error: e.message, tried: log, slopeside: [], town: [] });
  }
}
