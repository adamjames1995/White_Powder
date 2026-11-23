// Nearby webcams from the Windy Webcams API v3 (free tier is fine for personal use;
// image tokens expire after 10 min, so the app re-requests on each visit).
export default async function handler(req, res) {
  const key = process.env.WINDY_WEBCAMS_KEY;
  if (!key) return res.status(501).json({ error: 'WINDY_WEBCAMS_KEY not set', webcams: [] });
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  const radiusKm = Math.min(50, Number(req.query.radius) || 15);
  const url = `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lon},${radiusKm}&include=images,urls&limit=12`;
  try {
    const r = await fetch(url, { headers: { 'x-windy-api-key': key } });
    if (!r.ok) throw new Error(`Windy ${r.status}`);
    const j = await r.json();
    const webcams = (j.webcams || [])
      .map((c) => ({
        id: c.webcamId,
        title: c.title,
        image: c.images?.current?.preview || c.images?.daylight?.preview,
        link: c.urls?.detail || `https://www.windy.com/webcams/${c.webcamId}`,
      }))
      .filter((c) => c.image);
    res.setHeader('Cache-Control', 's-maxage=300');
    res.status(200).json({ webcams });
  } catch (e) {
    res.status(502).json({ error: e.message, webcams: [] });
  }
}
