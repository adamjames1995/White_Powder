import { redis } from './_redis.js';
import { push, subId, validSub } from './_push.js';
import { RESORTS } from '../lib/resorts.js';

const defaults = new Map(RESORTS.map((r) => [r.id, r]));

/** Accept resort ids (defaults) or {id,name,lat,lon,summitFt} objects; cap at 30. */
function cleanResorts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map((x) => {
    const r = typeof x === 'string' ? defaults.get(x) : x;
    if (!r) return null;
    const lat = Number(r.lat), lon = Number(r.lon), summitFt = Number(r.summitFt);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && summitFt > -1000 && summitFt < 30000)) return null;
    return { id: String(r.id).slice(0, 60), name: String(r.name || r.id).slice(0, 80), lat, lon, summitFt };
  }).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const { action, subscription, prefs } = body;
  if (!validSub(subscription)) return res.status(400).send('Invalid subscription');
  const id = subId(subscription);

  try {
    if (action === 'remove') {
      await redis('HDEL', 'subs', id);
      return res.status(200).json({ ok: true });
    }
    if (action === 'test') {
      await push().sendNotification(subscription, JSON.stringify({
        title: 'White Powder test ❄',
        body: 'Alerts are working on this device.',
        url: '/#/settings',
      }));
      return res.status(200).json({ ok: true });
    }
    // save
    const clean = {
      threshold: Math.min(48, Math.max(1, Number(prefs?.threshold) || 6)),
      withinDays: Math.min(7, Math.max(1, Number(prefs?.withinDays) || 3)),
      resorts: cleanResorts(prefs?.resorts),
    };
    await redis('HSET', 'subs', id, JSON.stringify({ subscription, prefs: clean, updated: new Date().toISOString() }));
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return res.status(500).send(e.message);
  }
}
