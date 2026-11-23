// Food & drink near a mountain. Primary: Nominatim (OpenStreetMap place search) — fast and dependable.
// Secondary: Overpass, which also gives the ski-area outline, when its public servers aren't overloaded.
import { foodQuery, fetchOverpass, buildFood, NOMINATIM_KINDS, nominatimUrl, nominatimToElements, OVERPASS } from '../lib/food.js';

export const config = { maxDuration: 60 };
const UA = 'WhitePowder/1.0 (personal ski forecast app; https://github.com/adamjames1995/White_Powder)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nominatim(lat, lon, log) {
  const els = [];
  for (const [i, kind] of NOMINATIM_KINDS.entries()) {
    if (i) await sleep(1100); // Nominatim usage policy: max 1 request per second
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(nominatimUrl(kind, lat, lon), { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`nominatim ${kind} → ${r.status}`);
      els.push(...nominatimToElements(await r.json()));
    } catch (e) { log.push(e.name === 'AbortError' ? `nominatim ${kind} timed out` : e.message); }
    finally { clearTimeout(t); }
  }
  return els;
}

export default async function handler(req, res) {
  if (req.query.ping) {
    const out = await Promise.all([...OVERPASS.map((u) => ({ u, post: true })), { u: nominatimUrl('restaurant', 39.1969, -120.2358) }].map(async ({ u, post }) => {
      const t0 = Date.now(); const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(u, post
          ? { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: 'data=' + encodeURIComponent('[out:json][timeout:5];node(1);out;') }
          : { signal: ctrl.signal, headers: { 'user-agent': UA } });
        return { url: new URL(u).host, status: r.status, ms: Date.now() - t0, body: (await r.text()).slice(0, 80) };
      } catch (e) { return { url: new URL(u).host, error: e.name === 'AbortError' ? 'timeout 8s' : e.message, ms: Date.now() - t0 }; }
      finally { clearTimeout(to); }
    }));
    return res.status(200).json(out);
  }
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  const log = [];
  try {
    // Run both; Overpass gets a short leash so a busy server doesn't hold things up.
    const [nom, ovp] = await Promise.all([
      nominatim(lat, lon, log),
      fetchOverpass(foodQuery(lat, lon), { timeoutMs: 12000, headers: { 'user-agent': UA } }).catch((e) => { log.push(`overpass: ${e.message}`); return []; }),
    ]);
    const els = [...ovp, ...nom];
    if (!els.some((e) => e.tags?.amenity)) throw new Error(log.join('; ') || 'no places found');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ...buildFood(els, lat, lon), source: 'OpenStreetMap contributors', via: { nominatim: nom.length, overpass: ovp.length }, ...(req.query.debug ? { log } : {}) });
  } catch (e) {
    res.status(req.query.debug ? 200 : 502).json({ error: e.message, tried: log, slopeside: [], town: [] });
  }
}
