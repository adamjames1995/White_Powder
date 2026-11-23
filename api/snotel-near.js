// Find the nearest active SNOTEL station to a point (US only). Station list cached per instance.
let cache = null;

async function stations() {
  if (cache && Date.now() - cache.at < 24 * 3600e3) return cache.list;
  const r = await fetch('https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?networkCds=SNTL&activeOnly=true&returnForecastPointMetadata=false&returnReservoirMetadata=false&returnStationElements=false');
  if (!r.ok) throw new Error(`NRCS ${r.status}`);
  const j = await r.json();
  const list = (Array.isArray(j) ? j : j.stations || [])
    .map((s) => ({
      triplet: s.stationTriplet || s.triplet,
      name: s.name,
      lat: Number(s.latitude),
      lon: Number(s.longitude),
      elevFt: Number(s.elevation),
    }))
    .filter((s) => s.triplet && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  cache = { at: Date.now(), list };
  return list;
}

function km(a, b, c, d) {
  const R = 6371, toR = Math.PI / 180;
  const x = Math.sin(((c - a) * toR) / 2) ** 2 + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(((d - b) * toR) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  const maxKm = Math.min(60, Number(req.query.maxKm) || 30);
  try {
    let best = null;
    for (const s of await stations()) {
      const d = km(lat, lon, s.lat, s.lon);
      if (d <= maxKm && (!best || d < best.distKm)) best = { ...s, distKm: Math.round(d * 10) / 10 };
    }
    res.setHeader('Cache-Control', 's-maxage=86400');
    res.status(200).json(best || {});
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
