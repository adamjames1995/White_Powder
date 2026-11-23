// Proxy + parse NRCS SNOTEL hourly data (last 72 h): snow depth, SWE, temperature.
// Returns observed new snow over 24/72 h estimated from snow-depth rise.
export function parseSnotelCsv(csv) {
  const rows = csv
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .slice(1) // header
    .map((l) => {
      const [time, snwd, wteq, tobs] = l.split(',');
      const num = (v) => (v === undefined || v.trim() === '' ? null : Number(v));
      return { time: time.trim(), depth: num(snwd), swe: num(wteq), tempF: num(tobs) };
    })
    .filter((r) => r.time);
  const withDepth = rows.filter((r) => Number.isFinite(r.depth));
  if (!withDepth.length) return { depthIn: null, new24In: null, new72In: null, rows: rows.length };

  // Median of last 3 readings damps sensor noise.
  const last3 = withDepth.slice(-3).map((r) => r.depth).sort((a, b) => a - b);
  const now = last3[Math.floor(last3.length / 2)];
  const window = (hrs) => withDepth.slice(-hrs - 1, -1).map((r) => r.depth);
  const rise = (hrs) => {
    const w = window(hrs);
    return w.length ? Math.max(0, now - Math.min(...w)) : null;
  };
  const latest = rows[rows.length - 1];
  const sweRows = rows.filter((r) => Number.isFinite(r.swe));
  return {
    time: withDepth[withDepth.length - 1].time,
    depthIn: Math.round(now),
    new24In: rise(24),
    new72In: rise(72),
    sweIn: sweRows.length ? sweRows[sweRows.length - 1].swe : null,
    tempF: latest.tempF,
  };
}

export default async function handler(req, res) {
  const triplet = String(req.query.triplet || '');
  if (!/^\d+:[A-Z]{2}:SNTL$/i.test(triplet)) return res.status(400).json({ error: 'bad triplet' });
  const url = `https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/hourly/${triplet}%7Cid=%22%22%7Cname/-72,0/SNWD::value,WTEQ::value,TOBS::value`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`NRCS ${r.status}`);
    const out = parseSnotelCsv(await r.text());
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({ triplet, ...out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
