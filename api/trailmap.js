// Trail maps for a mountain:
//  1) OpenSkiMap ski area (named runs, lifts, difficulty) — used for the interactive map embed.
//  2) Official published trail-map images from Skimap.org (the community archive of resort maps),
//     found through the Skimap.org id OpenSkiMap links to each ski area.
const UA = 'WhitePowder/1.0 (personal ski forecast app; https://github.com/adamjames1995/White_Powder)';

async function get(url, { ms = 15000, json = true } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const accept = /\.xml$/.test(url) ? 'application/xml,text/xml;q=0.9,*/*;q=0.8' : /\.json$/.test(url) ? 'application/json,*/*;q=0.8' : 'text/html,*/*;q=0.8';
    const r = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname} → ${r.status}`);
    return json ? await r.json() : await r.text();
  } catch (e) {
    throw e.name === 'AbortError' ? new Error(`${new URL(url).host} timed out`) : e;
  } finally { clearTimeout(t); }
}

function km(a, b, c, d) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(ski|resort|area|mountain|mtn|the|at)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** A representative [lon, lat] for any GeoJSON geometry. */
export function anyCoord(g) {
  let c = g?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && c.length >= 2 ? c : null;
}

/** Pick the OpenSkiMap ski area nearest the point, preferring a name match (within 25 km). */
export function pickSkiArea(features, lat, lon, name) {
  const want = norm(name);
  let best = null;
  for (const f of Array.isArray(features) ? features : []) {
    const p = f?.properties || {};
    if (p.type && p.type !== 'skiArea') continue;
    const c = anyCoord(f.geometry);
    if (!c) continue;
    const d = km(lat, lon, c[1], c[0]);
    if (d > 25) continue;
    const n = norm(p.name);
    const hit = want && n && (n.includes(want) || want.includes(n));
    const score = d - (hit ? 15 : 0);
    if (!best || score < best.score) {
      best = {
        openskimapId: p.id || f.id || null,
        name: p.name || null,
        skimapId: (p.sources || []).find((s) => /skimap/i.test(s.type))?.id || null,
        distKm: Math.round(d * 10) / 10,
        score,
      };
    }
  }
  return best;
}

/** Skimap.org XML: collect image URLs and years from each <skiMap> block (structure-agnostic). */
export function mapsFromXml(xml) {
  const out = [];
  const blocks = xml.match(/<skiMap\b[\s\S]*?<\/skiMap>|<skiMap\b[^>]*\/>/gi) || [];
  for (const b of blocks) {
    const urls = [...new Set((b.match(/https?:\/\/[^"'<> ]+\.(?:jpe?g|png|webp|gif|pdf)/gi) || []))];
    const imgs = urls.filter((u) => !/\.pdf$/i.test(u));
    const id = (b.match(/\bid="(\d+)"/) || [])[1];
    const year = Number((b.match(/year(?:Published|_published)?[^>]*?>?\s*"?(\d{4})/i) || [])[1]) || null;
    if (!urls.length && !id) continue;
    out.push({
      id, year,
      image: imgs.find((u) => /(large|full|original)/i.test(u)) || [...imgs].sort((a, b) => b.length - a.length)[0] || null,
      thumb: imgs.find((u) => /(thumb|small|medium)/i.test(u)) || imgs[0] || null,
      pdf: urls.find((u) => /\.pdf$/i.test(u)) || null,
      page: id ? `https://skimap.org/SkiMaps/view/${id}` : null,
    });
  }
  return out.filter((m) => m.image || m.thumb).sort((a, b) => (b.year || 0) - (a.year || 0));
}

/** Pull map images out of a Skimap.org ski-area record, whatever its exact shape. */
export function extractMaps(record) {
  const maps = [];
  const list = record?.ski_maps || record?.skiMaps || record?.maps || [];
  for (const m of Array.isArray(list) ? list : []) {
    const urls = [];
    (function walk(o) {
      if (!o) return;
      if (typeof o === 'string') { if (/^https?:\/\/.+\.(jpe?g|png|webp|gif|pdf)(\?.*)?$/i.test(o)) urls.push(o); return; }
      if (typeof o === 'object') Object.values(o).forEach(walk);
    })(m);
    const images = urls.filter((u) => !/\.pdf/i.test(u));
    if (!urls.length) continue;
    const pick = (re) => images.find((u) => re.test(u));
    maps.push({
      id: m.id,
      year: Number(m.year_published || m.year || m.published) || null,
      image: pick(/(large|full|original)/i) || [...images].sort((a, b) => b.length - a.length)[0] || null,
      thumb: pick(/(thumb|small|medium)/i) || images[0] || null,
      pdf: urls.find((u) => /\.pdf/i.test(u)) || null,
      page: m.id ? `https://skimap.org/SkiMaps/view/${m.id}` : null,
    });
  }
  return maps.sort((a, b) => (b.year || 0) - (a.year || 0));
}

const absUrl = (u, base = 'https://skimap.org') => (u.startsWith('//') ? `https:${u}` : u.startsWith('/') ? base + u : u);
const metaContent = (html, prop) => (html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, 'i'))
  || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')) || [])[1];

/** Skimap.org only serves HTML to us: list the area's map pages, then read each map's image. */
export async function skimapFromHtml(id, log) {
  const html = await get(`https://skimap.org/SkiAreas/view/${id}`, { json: false });
  const ids = [...new Set([...html.matchAll(/\/skimaps\/(?:view\/)?(\d+)/gi)].map((m) => m[1]))].slice(0, 5);
  // Map thumbnails on the area page (files.skimap.org/<key>, no extension), with alt/nearby text.
  const thumbs = [...html.matchAll(/<img[^>]+>/gi)].map((m) => m[0])
    .map((tag) => ({ src: absUrl((tag.match(/src=["']([^"']+)/i) || [])[1] || ''), alt: (tag.match(/alt=["']([^"']*)/i) || [])[1] || '' }))
    .filter((x) => /files\.skimap\.org/i.test(x.src));
  log?.push(`area page: ${ids.length} map links: ${ids.join(',')}; links: ${[...html.matchAll(/href=["']([^"']+)/gi)].map((m) => m[1]).filter((h) => /map/i.test(h)).slice(0, 10).join(' | ')}; thumbs: ${thumbs.slice(0, 4).map((t) => `${t.src} [${t.alt}]`).join(' | ')}`);
  // The area page's og:image is Skimap.org's pick for the current trail map — always lead with it.
  const og = metaContent(html, 'og:image');
  const ogAlt = metaContent(html, 'og:image:alt') || metaContent(html, 'twitter:image:alt') || '';
  const current = og ? [{ id: 'current', year: null, title: ogAlt || 'Current trail map', image: absUrl(og), thumb: absUrl(og), pdf: null, page: `https://skimap.org/SkiAreas/view/${id}` }] : [];
  const maps = [];
  if (current.length) return current;
  if (!ids.length) {
    return thumbs.slice(0, 6).map((t, i) => ({
      id: i, year: Number((t.alt.match(/\b(19[5-9]\d|20[0-4]\d)\b/) || [])[1]) || null,
      image: t.src, thumb: t.src, pdf: null, page: `https://skimap.org/SkiAreas/view/${id}`,
    })).sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  for (const mid of ids) {
    try {
      const page = await get(`https://skimap.org/skimaps/${mid}`, { json: false, ms: 10000 }).catch(() => get(`https://skimap.org/SkiMaps/view/${mid}`, { json: false, ms: 10000 }));
      const imgs = [...page.matchAll(/(?:src|href)=["']([^"']*(?:files\.skimap\.org\/[^"']+|\.(?:jpe?g|png|webp)))["']/gi)].map((m) => absUrl(m[1]));
      const og = metaContent(page, 'og:image');
      const image = imgs.find((u) => /(full|large|original)/i.test(u)) || og || imgs.sort((a, b) => b.length - a.length)[0];
      const thumb = og || imgs.find((u) => /(thumb|small|medium)/i.test(u)) || image;
      const year = Number(((metaContent(page, 'og:title') || '') + ' ' + ((page.match(/<title>([^<]+)/i) || [])[1] || '')).match(/\b(19[5-9]\d|20[0-4]\d)\b/)?.[1]) || null;
      const pdf = (page.match(/(?:href)=["']([^"']+\.pdf)["']/i) || [])[1];
      log?.push(`map ${mid}: og=${og || '-'} imgs=${imgs.slice(0, 4).join(' | ')}`);
      if (image) maps.push({ id: mid, year, image: absUrl(image), thumb: absUrl(thumb), pdf: pdf ? absUrl(pdf) : null, page: `https://skimap.org/SkiMaps/view/${mid}` });
    } catch (e) { log?.push(`map ${mid}: ${e.message}`); }
  }
  return maps.sort((a, b) => (b.year || 0) - (a.year || 0));
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon), name = String(req.query.name || '').slice(0, 80);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  const log = [];
  let area = null, maps = [];
  try {
    const q = name || `${lat},${lon}`;
    const results = await get(`https://api.openskimap.org/search?query=${encodeURIComponent(q)}`);
    area = pickSkiArea(Array.isArray(results) ? results : results?.features, lat, lon, name);
    if (!area) log.push('no OpenSkiMap ski area near this point');
  } catch (e) { log.push(`openskimap: ${e.message}`); }
  if (area?.skimapId) {
    try { maps = await skimapFromHtml(area.skimapId, req.query.debug ? log : null); }
    catch (e) { log.push(`skimap: ${e.message}`); }
  }
  res.setHeader('Cache-Control', area ? 's-maxage=604800, stale-while-revalidate=2592000' : 'no-store');
  res.status(200).json({
    area: area && { ...area, skimapUrl: area.skimapId ? `https://skimap.org/SkiAreas/view/${area.skimapId}` : null },
    maps,
    ...(req.query.debug || !area ? { log } : {}),
  });
}
