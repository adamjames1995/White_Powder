// Called on a schedule (GitHub Actions). Checks summit forecasts and pushes powder alerts.
import { RESORTS, byId } from '../lib/resorts.js';
import { fetchForecast, processPoint } from '../lib/snow.js';
import { redis, allSubs } from './_redis.js';
import { push } from './_push.js';

const dow = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).send('unauthorized');

  try {
    const subs = await allSubs();
    if (!subs.length) return res.status(200).json({ subs: 0, sent: 0 });

    const points = RESORTS.map((r) => ({ resort: r.id, lat: r.lat, lon: r.lon, elevFt: r.summitFt }));
    const locs = await fetchForecast(points, { pastDays: 0, forecastDays: 8, apiKey: process.env.OPEN_METEO_API_KEY });
    const days = Object.fromEntries(points.map((p, i) => [p.resort, processPoint(locs[i], p.elevFt).days]));

    let sent = 0, removed = 0;
    const log = [];
    for (const s of subs) {
      const { threshold, withinDays, resorts } = s.prefs || {};
      const hits = [];
      for (const rid of resorts || []) {
        const d = (days[rid] || []).slice(0, withinDays || 3).filter((x) => x.snow >= (threshold || 6));
        if (!d.length) continue;
        const best = d.reduce((a, b) => (b.snow > a.snow ? b : a));
        // Alert once per resort per storm day.
        const fresh = await redis('SET', `sent:${s.id}:${rid}:${best.date}`, '1', 'NX', 'EX', 864000);
        if (fresh === 'OK') hits.push({ rid, ...best });
      }
      if (!hits.length) continue;
      hits.sort((a, b) => b.snow - a.snow);
      const body = hits.map((h) => `${byId(h.rid).name}: ${Math.round(h.snow)}" ${dow(h.date)} (range ${Math.round(h.min)}–${Math.round(h.max)}")`).join('\n');
      try {
        await push().sendNotification(s.subscription, JSON.stringify({
          title: `❄ Powder alert — ${Math.round(hits[0].snow)}" at ${byId(hits[0].rid).name}`,
          body,
          tag: `powder-${hits[0].rid}-${hits[0].date}`,
          url: `/#/resort/${hits[0].rid}`,
        }));
        sent++;
        log.push({ sub: s.id, hits: hits.map((h) => `${h.rid}:${h.date}:${h.snow.toFixed(1)}`) });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { await redis('HDEL', 'subs', s.id); removed++; }
        else log.push({ sub: s.id, error: e.message });
      }
    }
    res.status(200).json({ subs: subs.length, sent, removed, log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
