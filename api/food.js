// Server fallback for the food lookup (the app normally queries Overpass directly from the phone).
import { foodQuery, fetchOverpass, buildFood } from '../lib/food.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  try {
    const els = await fetchOverpass(foodQuery(lat, lon), { timeoutMs: 25000 });
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ...buildFood(els, lat, lon), source: 'OpenStreetMap contributors' });
  } catch (e) {
    res.status(502).json({ error: e.message, slopeside: [], town: [] });
  }
}
