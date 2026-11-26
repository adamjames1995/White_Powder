// Cams near a mountain, from two kinds of source:
//  · Windy Webcams API v3 (worldwide, includes resort/town cams; needs WINDY_WEBCAMS_KEY; image tokens expire after 10 min)
//  · State/provincial highway cams that need no key: Caltrans (CA), WSDOT (WA), DriveBC (BC)
import { dist } from '../lib/skiarea.js';

const UA = 'WhitePowder/1.0 (personal ski forecast app)';
async function get(url, ms = 8000, headers = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const CA_D = { 2: [40, -124.5, 42.1, -119.9], 3: [38.2, -123.1, 40.5, -119.9], 6: [35.0, -120.8, 37.6, -117.9], 8: [33.4, -118.0, 35.9, -114.1], 9: [35.5, -119.5, 38.7, -117.4], 10: [37.0, -121.6, 38.9, -119.1] };
const inside = (lat, lon, [a, b, c, d]) => lat >= a && lat <= c && lon >= b && lon <= d;

async function windy(lat, lon, km, key) {
  const j = await get(`https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lon},${km}&include=images,urls,player,location&limit=20`, 9000, { 'x-windy-api-key': key });
  return (j.webcams || []).map((c) => ({
    id: `w${c.webcamId}`, title: c.title, src: 'Windy',
    image: c.images?.current?.preview || c.images?.daylight?.preview,
    link: c.urls?.detail || `https://www.windy.com/webcams/${c.webcamId}`,
    // Timelapse player (v3 returns strings or {available, embed}); fall back to Windy's public player URL so every cam plays in-app.
    embed: (typeof c.player?.live === 'string' && c.player.live) || (c.player?.live?.available && c.player.live.embed) || (typeof c.player?.day === 'string' && c.player.day) || c.player?.day?.embed || `https://webcams.windy.com/webcams/public/embed/player/${c.webcamId}/day`,
    live: !!(c.player?.live && (typeof c.player.live === 'string' || c.player.live.available)),
    km: c.location ? dist([lat, lon], [c.location.latitude, c.location.longitude]) / 1000 : null,
  })).filter((c) => c.image);
}
async function caltrans(lat, lon, km) {
  const ds = Object.entries(CA_D).filter(([, b]) => inside(lat, lon, [b[0] - 0.4, b[1] - 0.4, b[2] + 0.4, b[3] + 0.4])).map(([d]) => d);
  const out = [];
  await Promise.all(ds.map((d) => get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, '0')}.json`).then((j) => {
    for (const x of j.data || []) {
      const c = x.cctv, L = c?.location; if (!L || c.inService === 'false') continue;
      const la = num(L.latitude), lo = num(L.longitude); const img = c.imageData?.static?.currentImageURL;
      if (la == null || !img) continue;
      const k = dist([lat, lon], [la, lo]) / 1000; if (k > km) continue;
      out.push({ id: `ca${c.index}`, title: titleCase(L.locationName || L.nearbyPlace), src: 'Caltrans', image: img, link: c.imageData?.streamingVideoURL || img, embed: null, live: false, km: k, road: true });
    }
  }).catch(() => {})));
  return out;
}
async function wsdot(lat, lon, km) {
  const d = km / 111, e = d / Math.cos(lat * Math.PI / 180);
  const q = new URLSearchParams({ where: '1=1', outFields: '*', f: 'json', returnGeometry: 'true', outSR: '4326', inSR: '4326', geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects', geometry: `${lon - e},${lat - d},${lon + e},${lat + d}` });
  const j = await get(`https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?${q}`).catch(() => ({}));
  return (j.features || []).filter((f) => f.attributes?.ImageURL && f.geometry).map((f) => ({
    id: `wa${f.attributes.OBJECTID}`, title: f.attributes.CameraTitle, src: 'WSDOT', image: f.attributes.ImageURL, link: f.attributes.ImageURL, embed: null, live: false,
    km: dist([lat, lon], [f.geometry.y, f.geometry.x]) / 1000, road: true,
  })).filter((c) => c.km <= km);
}
async function drivebc(lat, lon, km) {
  const j = await get('https://www.drivebc.ca/api/webcams/', 12000).catch(() => []);
  return (Array.isArray(j) ? j : []).filter((c) => c.is_on !== false && c.should_appear !== false && c.location?.coordinates).map((c) => {
    const [lo, la] = c.location.coordinates; const rel = c.links?.imageDisplay || `/images/${c.id}.jpg`;
    return { id: `bc${c.id}`, title: c.name, src: 'DriveBC', image: rel.startsWith('http') ? rel : `https://www.drivebc.ca${rel}`, link: `https://www.drivebc.ca/images/${c.id}.jpg`, embed: null, live: false, km: dist([lat, lon], [la, lo]) / 1000, road: true };
  }).filter((c) => c.km <= km);
}
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Sr|Us|I|Hwy)\b/g, (x) => x.toUpperCase());

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required', webcams: [] });
  const km = Math.min(50, Number(req.query.radius) || 30);
  const key = process.env.WINDY_WEBCAMS_KEY;
  const ca = lat > 32 && lat < 42.1 && lon > -124.6 && lon < -114, wa = lat > 45.5 && lat < 49.1 && lon > -124.9 && lon < -116.9, bc = lat > 48.2 && lat < 60.1 && lon > -139.1 && lon < -114;
  const errors = [];
  const [w, c1, c2, c3] = await Promise.all([
    key ? windy(lat, lon, Math.min(km, 25), key).catch((e) => { errors.push(e.message); return []; }) : Promise.resolve([]),
    ca ? caltrans(lat, lon, km) : [], wa ? wsdot(lat, lon, km) : [], bc ? drivebc(lat, lon, km) : [],
  ]);
  const road = [...c1, ...c2, ...c3].sort((a, b) => a.km - b.km).slice(0, 10);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ webcams: [...w.sort((a, b) => (a.km ?? 99) - (b.km ?? 99)), ...road], windy: !!key, errors });
}
