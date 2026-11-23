import { redis } from './_redis.js';
import { push, subId, validSub } from './_push.js';
import { RESORTS } from '../lib/resorts.js';

const ids = new Set(RESORTS.map((r) => r.id));

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
      resorts: (prefs?.resorts || []).filter((r) => ids.has(r)),
    };
    await redis('HSET', 'subs', id, JSON.stringify({ subscription, prefs: clean, updated: new Date().toISOString() }));
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return res.status(500).send(e.message);
  }
}
