// Ski squad: share live location + game plan with friends via a 4-letter code (Upstash Redis, expires overnight).
import { redis } from './_redis.js';

const TTL = 18 * 3600; // squads vanish after a day
const clean = (s, n) => String(s ?? '').replace(/[<>]/g, '').slice(0, n);
const okCode = (c) => /^[A-Z]{4}$/.test(c);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const code = String(req.query.code || '').toUpperCase();
      if (!okCode(code)) return res.status(400).json({ error: 'bad code' });
      const flat = (await redis('HGETALL', `squad:${code}`)) || [];
      const cutoff = Date.now() - 30 * 60 * 1000;
      const members = [];
      for (let i = 0; i < flat.length; i += 2) { try { const m = JSON.parse(flat[i + 1]); if (m.at > cutoff) members.push(m); } catch {} }
      return res.status(200).json({ code, members, exists: flat.length > 0 });
    }
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (b.action === 'create') {
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      for (let k = 0; k < 6; k++) {
        const code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
        if (!(await redis('EXISTS', `squad:${code}`))) {
          await redis('HSET', `squad:${code}`, '_', JSON.stringify({ at: 0 }));
          await redis('EXPIRE', `squad:${code}`, TTL);
          return res.status(200).json({ code });
        }
      }
      return res.status(503).json({ error: 'try again' });
    }
    if (b.action === 'update') {
      const code = String(b.code || '').toUpperCase();
      if (!okCode(code)) return res.status(400).json({ error: 'bad code' });
      const m = b.member || {};
      const id = clean(m.id, 24);
      if (!id) return res.status(400).json({ error: 'no member id' });
      const rec = {
        id, name: clean(m.name, 24) || 'Skier', at: Date.now(),
        lat: Number.isFinite(m.lat) ? +m.lat.toFixed(5) : null, lon: Number.isFinite(m.lon) ? +m.lon.toFixed(5) : null,
        state: clean(m.state, 12), lift: clean(m.lift, 40), plan: clean(m.plan, 140), runs: Number(m.runs) || 0, vertFt: Number(m.vertFt) || 0,
      };
      await redis('HSET', `squad:${code}`, id, JSON.stringify(rec));
      await redis('EXPIRE', `squad:${code}`, TTL);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'leave') {
      const code = String(b.code || '').toUpperCase();
      if (okCode(code)) await redis('HDEL', `squad:${code}`, clean(b.id, 24));
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    const setup = /not configured/i.test(e.message);
    return res.status(setup ? 501 : 500).json({ error: setup ? 'setup' : e.message });
  }
}
