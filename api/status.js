// Live lift status read straight from each resort's own lift-status feed
// (same sources Liftie uses: mtnpowder.com JSON for Alterra resorts, the TerrainStatusFeed on Vail Resorts pages).
import vm from 'node:vm';

const FEEDS = {
  palisades: { type: 'mtnpowder', id: 61, page: 'https://www.palisadestahoe.com/mountain-information/lift-and-grooming-status' },
  'crystal-mountain': { type: 'mtnpowder', id: 80, page: 'https://www.crystalmountainresort.com/the-mountain/mountain-report' },
  kirkwood: { type: 'vail', url: 'https://www.kirkwood.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx' },
  stevens: { type: 'vail', url: 'https://www.stevenspass.com/the-mountain/mountain-conditions/lift-and-terrain-status.aspx' },
  'whistler-blackcomb': { type: 'vail', url: 'https://www.whistlerblackcomb.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx' },
};

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function get(url, accept = '*/*') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.9' } });
    const body = await r.text();
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return body;
  } catch (e) {
    throw e.name === 'AbortError' ? new Error(`${new URL(url).host} timed out`) : e;
  } finally { clearTimeout(t); }
}

const MAP = {
  open: 'open', opened: 'open', o: 'open', y: 'open', yes: 'open', 1: 'open',
  closed: 'closed', close: 'closed', closedfortheday: 'closed', closedforseason: 'closed', n: 'closed', no: 'closed', 0: 'closed', 3: 'closed',
  hold: 'hold', onhold: 'hold', windhold: 'hold', weatherhold: 'hold', maintenancehold: 'hold', mechanicalhold: 'hold', standby: 'hold', delayed: 'hold',
  scheduled: 'scheduled', expected: 'scheduled', anticipated: 'scheduled', 2: 'scheduled',
};
export const coerce = (s) => {
  const k = String(s ?? '').replace(/[\s_-]+/g, '').toLowerCase();
  if (MAP[k]) return MAP[k];
  if (/hold/.test(k)) return 'hold';
  if (/closed/.test(k)) return 'closed';
  if (/open/.test(k)) return 'open';
  return 'scheduled';
};

export function fromMtnpowder(arr) {
  return (Array.isArray(arr) ? arr : []).map((l) => ({ name: String(l.Name || '').trim(), raw: String(l.StatusEnglish || l.Status || '').trim(), status: coerce(l.StatusEnglish || l.Status) }));
}

const VAIL = ['closed', 'open', 'hold', 'scheduled'];
// Vail Resorts pages: the top-level Lifts array only lists lifts that are currently running;
// the full list lives under each GroomingArea. Merge both (deduped) and cross-check with the
// "4 / 13 Lifts Open" figure printed on the page.
export function fromVailHtml(html) {
  const i = html.indexOf('TerrainStatusFeed = {');
  if (i < 0) throw new Error('lift feed not found on page');
  const start = html.lastIndexOf('<script', i);
  const end = html.indexOf('</script>', i);
  const script = html.slice(html.indexOf('>', start) + 1, end);
  const ctx = { FR: {} };
  vm.runInNewContext(script, ctx, { timeout: 200 });
  const f = ctx.FR?.TerrainStatusFeed || {};
  const seen = new Map();
  const add = (l) => { const k = l.Id ?? l.Name; if (k == null) return; const prev = seen.get(k); if (!prev || (prev.Status !== 1 && l.Status === 1)) seen.set(k, l); };
  (f.Lifts || []).forEach(add);
  (f.GroomingAreas || []).forEach((a) => (a.Lifts || []).forEach(add));
  const lifts = [...seen.values()].map((l) => ({ name: String(l.Name || '').trim(), raw: VAIL[l.Status] || String(l.Status), status: VAIL[l.Status] || 'scheduled' }));
  const m = html.match(/(\d+)\s*(?:<[^>]+>\s*)*\/\s*(?:<[^>]+>\s*)*(\d+)(?:\s*<[^>]+>)*\s*Lifts\s*Open/i);
  if (m) lifts.pageCount = { open: Number(m[1]), total: Number(m[2]) };
  return lifts;
}

export function summarize(lifts) {
  const count = (s) => lifts.filter((l) => l.status === s).length;
  // Reasons in the resort's own wording for lifts that aren't open (e.g. "Wind Hold", "Closed for Season").
  const reasons = {};
  for (const l of lifts) if (l.status !== 'open' && l.raw && !/^(closed|scheduled|open)$/i.test(l.raw)) reasons[l.raw] = (reasons[l.raw] || 0) + 1;
  // The resort's own printed "open / total" wins when we have it.
  const pc = lifts.pageCount && lifts.pageCount.total > 0 ? lifts.pageCount : null;
  const open = pc ? pc.open : count('open'), total = pc ? pc.total : lifts.length;
  const hold = count('hold'), scheduled = count('scheduled');
  return {
    open, hold, scheduled, closed: Math.max(0, total - open - hold - scheduled), total,
    holdLifts: lifts.filter((l) => l.status === 'hold').map((l) => l.name).slice(0, 8),
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, n]) => ({ text, n })),
  };
}

export default async function handler(req, res) {
  const id = String(req.query.id || '').replace(/[^a-z0-9-]/gi, '');
  const feed = FEEDS[id];
  if (!feed) { res.setHeader('Cache-Control', 's-maxage=86400'); return res.status(200).json({ found: false }); }
  if (req.query.snip && feed.type === 'mtnpowder') {
    const arr = JSON.parse(await get(`https://mtnpowder.com/feed/${feed.id}/lifts`, 'application/json'));
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send([`lifts: ${arr.length}`, `keys: ${Object.keys(arr[0] || {}).join(',')}`, ...arr.map((l) => `${l.Name} | ${l.StatusEnglish || l.Status} | ${l.LiftType || l.Type || ''} | ${l.MountainAreaName || ''}`)].join('\n'));
  }
  if (req.query.snip && feed.type === 'vail') {
    try {
      const html = await get(feed.url, 'text/html');
      const k = html.indexOf('TerrainStatusFeed = {');
      const st = html.lastIndexOf('<script', k), en = html.indexOf('</script>', k);
      const ctx = { FR: {} };
      vm.runInNewContext(html.slice(html.indexOf('>', st) + 1, en), ctx, { timeout: 200 });
      const f = ctx.FR.TerrainStatusFeed || {};
      const lines = [`keys: ${Object.keys(f).join(',')}`, `lifts: ${(f.Lifts || []).length}`];
      if (f.Lifts?.[0]) lines.push(`liftkeys: ${Object.keys(f.Lifts[0]).join(',')}`);
      for (const l of f.Lifts || []) lines.push(`${l.Name} | ${l.Status} | ${l.Type ?? ''} | ${l.Mountain ?? ''}`);
      for (const [key, v] of Object.entries(f)) if (Array.isArray(v) && key !== 'Lifts') lines.push(`${key}: ${v.length} items; first keys ${v[0] ? Object.keys(v[0]).join(',') : ''}`);
      const m = html.match(/(\d+)\s*(?:<[^>]+>\s*)*\/\s*(?:<[^>]+>\s*)*(\d+)(?:\s*<[^>]+>)*\s*Lifts\s*Open/i);
      lines.push(`htmlcount: ${m ? m[1] + '/' + m[2] : 'none'}`);
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(lines.join('\n'));
    } catch (e) { return res.status(200).send(String(e)); }
  }
  try {
    let lifts;
    if (feed.type === 'mtnpowder') lifts = fromMtnpowder(JSON.parse(await get(`https://mtnpowder.com/feed/${feed.id}/lifts`, 'application/json')));
    else lifts = fromVailHtml(await get(feed.url, 'text/html'));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ found: true, id, url: feed.page || feed.url, ...summarize(lifts), source: 'resort lift-status feed', fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(req.query.debug ? 200 : 502).json({ error: e.message || String(e), url: feed.page || feed.url });
  }
}
