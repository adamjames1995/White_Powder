import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { MODELS } from '../lib/snow.js';

test('check-alerts handles custom mountain objects and legacy ids', async () => {
  const keys = webpush.generateVAPIDKeys();
  Object.assign(process.env, { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, CRON_SECRET: 's', KV_REST_API_URL: 'https://redis.test', KV_REST_API_TOKEN: 't' });
  const sent = [];
  webpush.sendNotification = async (sub, payload) => { sent.push(JSON.parse(payload)); };
  const subs = {
    a: { subscription: { endpoint: 'https://p/a', keys: { p256dh: 'x', auth: 'y' } }, prefs: { threshold: 6, withinDays: 3, resorts: [{ id: 'vail', name: 'Vail', lat: 39.64, lon: -106.37, summitFt: 11570 }] } },
    b: { subscription: { endpoint: 'https://p/b', keys: { p256dh: 'x', auth: 'y' } }, prefs: { threshold: 6, withinDays: 3, resorts: ['palisades'] } },
  };
  const fakeLoc = () => {
    const start = Date.now() - (Date.now() % 86400000);
    const time = Array.from({ length: 8 * 24 }, (_, i) => new Date(start + i * 3600e3).toISOString().slice(0, 16));
    const h = { time };
    for (const { key } of MODELS) { h[`temperature_2m_${key}`] = time.map(() => -6); h[`precipitation_${key}`] = time.map(() => 2); }
    return { utc_offset_seconds: 0, hourly: h };
  };
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://redis.test')) {
      const cmd = JSON.parse(opts.body);
      if (cmd[0] === 'HGETALL') return { json: async () => ({ result: Object.entries(subs).flatMap(([k, v]) => [k, JSON.stringify(v)]) }) };
      return { json: async () => ({ result: 'OK' }) };
    }
    const n = new URL(url).searchParams.get('latitude').split(',').length;
    return { ok: true, status: 200, text: async () => JSON.stringify(Array.from({ length: n }, fakeLoc)) };
  };
  const { default: handler } = await import('../api/check-alerts.js');
  let out;
  const res = { status(c) { this.c = c; return this; }, json(j) { out = j; }, send(t) { out = t; } };
  await handler({ headers: { authorization: 'Bearer s' } }, res);
  assert.equal(res.c, 200, JSON.stringify(out));
  assert.equal(out.sent, 2);
  assert.ok(sent.some((p) => p.title.includes('Vail')));
  assert.ok(sent.some((p) => p.title.includes('Palisades Tahoe')));
});
