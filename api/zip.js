// ZIP / postal code → place + coordinates (Zippopotam.us). US by default; ?country=ca etc. for others.
export default async function handler(req, res) {
  const zip = String(req.query.zip || '').trim().replace(/\s+/g, '').slice(0, 10);
  const country = String(req.query.country || 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'us';
  if (!/^[a-z0-9-]{3,10}$/i.test(zip)) return res.status(400).json({ error: 'Enter a ZIP code' });
  try {
    const r = await fetch(`https://api.zippopotam.us/${country}/${encodeURIComponent(zip)}`);
    if (r.status === 404) return res.status(404).json({ error: 'ZIP code not found' });
    if (!r.ok) throw new Error(`zip lookup ${r.status}`);
    const j = await r.json();
    const p = (j.places || [])[0];
    if (!p) return res.status(404).json({ error: 'ZIP code not found' });
    res.setHeader('Cache-Control', 's-maxage=2592000');
    res.status(200).json({
      zip, place: p['place name'], state: p.state, stateCode: p['state abbreviation'],
      country: j.country, lat: Number(p.latitude), lon: Number(p.longitude),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
