// First Tracks: route + traffic + road conditions (chain controls, closures, pass reports) + highway cams along the drive.
// Sources: TomTom (traffic, optional key) or OSRM; Caltrans CWWP2 (CA); WSDOT public ArcGIS (WA); DriveBC Open511 (BC).
import { distToLine, dist } from '../lib/skiarea.js';

const UA = 'WhitePowder/1.0 (personal ski forecast app)';
async function get(url, ms = 9000, accept = 'application/json') {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept } });
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return await r.json();
  } catch (e) { throw e.name === 'AbortError' ? new Error(`${new URL(url).host} timed out`) : e; }
  finally { clearTimeout(t); }
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// ---------- routing ----------
async function tomtomRoutes(from, to, departAt, key) {
  const loc = `${from[0]},${from[1]}:${to[0]},${to[1]}`;
  const q = new URLSearchParams({ key, traffic: 'true', maxAlternatives: '2', computeTravelTimeFor: 'all', routeType: 'fastest', travelMode: 'car', instructionsType: 'text' });
  if (departAt) q.set('departAt', departAt);
  const j = await get(`https://api.tomtom.com/routing/1/calculateRoute/${loc}/json?${q}`, 12000);
  return (j.routes || []).map((r) => ({
    km: r.summary.lengthInMeters / 1000, min: r.summary.travelTimeInSeconds / 60, delayMin: (r.summary.trafficDelayInSeconds || 0) / 60,
    noTrafficMin: (r.summary.noTrafficTravelTimeInSeconds ?? r.summary.travelTimeInSeconds) / 60,
    typicalMin: r.summary.historicTrafficTravelTimeInSeconds != null ? r.summary.historicTrafficTravelTimeInSeconds / 60 : null,
    depart: r.summary.departureTime, arrive: r.summary.arrivalTime,
    coords: r.legs.flatMap((l) => l.points.map((p) => [p.latitude, p.longitude])), traffic: true,
    roads: highways((r.guidance?.instructions || []).flatMap((i) => i.roadNumbers || [])),
  }));
}
async function osrmRoutes(from, to) {
  const j = await get(`https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&alternatives=2&steps=true`, 12000);
  return (j.routes || []).map((r) => ({ km: r.distance / 1000, min: r.duration / 60, delayMin: 0, noTrafficMin: r.duration / 60, typicalMin: null, coords: r.geometry.coordinates.map(([lo, la]) => [la, lo]), traffic: false,
    roads: highways((r.legs || []).flatMap((l) => (l.steps || []).flatMap((st) => String(st.ref || '').split(';')))) }));
}
// Travel time for several departure times (traffic forecast), best route only.
async function tomtomTimes(from, to, departs, key) {
  const out = [];
  await Promise.all(departs.map(async (d) => {
    try {
      const loc = `${from[0]},${from[1]}:${to[0]},${to[1]}`;
      const q = new URLSearchParams({ key, traffic: 'true', computeTravelTimeFor: 'all', departAt: d, routeRepresentation: 'summaryOnly' });
      const j = await get(`https://api.tomtom.com/routing/1/calculateRoute/${loc}/json?${q}`, 12000);
      const s = j.routes?.[0]?.summary;
      if (s) out.push({ depart: d, min: s.travelTimeInSeconds / 60, delayMin: (s.trafficDelayInSeconds || 0) / 60, arrive: s.arrivalTime });
    } catch {}
  }));
  return out.sort((a, b) => a.depart.localeCompare(b.depart));
}

/** Ordered, de-duplicated highway numbers (I-80, US 50, CA 88 …). */
function highways(list) {
  const out = [];
  for (const raw of list) {
    const x = String(raw || '').trim().replace(/\s+[NSEW]$/i, '').replace(/^(SR|CA|WA|BC)[ -]?/i, 'Hwy ').replace(/^US[ -]?/i, 'US-').replace(/^I[ -]?/i, 'I-');
    if (x && /\d/.test(x) && !/county|^cr\b/i.test(x) && !out.includes(x)) out.push(x);
  }
  return out.slice(0, 16);
}

// ---------- geometry helpers ----------
function thin(coords, stepM = 400) {
  const out = [coords[0]]; let acc = 0;
  for (let i = 1; i < coords.length; i++) { acc += dist(coords[i - 1], coords[i]); if (acc >= stepM) { out.push(coords[i]); acc = 0; } }
  out.push(coords[coords.length - 1]);
  return out;
}
function bbox(coords, pad = 0.08) {
  let a = 90, b = 180, c = -90, d = -180;
  for (const [la, lo] of coords) { a = Math.min(a, la); c = Math.max(c, la); b = Math.min(b, lo); d = Math.max(d, lo); }
  return { minLat: a - pad, minLon: b - pad, maxLat: c + pad, maxLon: d + pad };
}
const inBox = (bx, la, lo) => la >= bx.minLat && la <= bx.maxLat && lo >= bx.minLon && lo <= bx.maxLon;
const overlaps = (bx, minLat, minLon, maxLat, maxLon) => !(bx.maxLat < minLat || bx.minLat > maxLat || bx.maxLon < minLon || bx.minLon > maxLon);
/** Distance from the route (m) and fraction along it, for a point. */
const along = (line, la, lo) => distToLine([la, lo], line);

// ---------- California (Caltrans CWWP2) ----------
const CA_DISTRICTS = { 2: [40, -124.5, 42.1, -119.9], 3: [38.2, -123.1, 40.5, -119.9], 4: [36.9, -123.6, 38.9, -121.2], 6: [35.0, -120.8, 37.6, -117.9], 8: [33.4, -118.0, 35.9, -114.1], 9: [35.5, -119.5, 38.7, -117.4], 10: [37.0, -121.6, 38.9, -119.1] };
const dd = (n) => String(n).padStart(2, '0');
async function caltrans(bx, line) {
  const ds = Object.entries(CA_DISTRICTS).filter(([, b]) => overlaps(bx, ...b)).map(([d]) => Number(d));
  const chains = [], closures = [], cams = [], errors = [];
  await Promise.all(ds.flatMap((d) => [
    get(`https://cwwp2.dot.ca.gov/data/d${d}/cc/ccStatusD${dd(d)}.json`).then((j) => {
      for (const x of j.data || []) {
        const c = x.cc; const L = c?.location; if (!L) continue;
        const la = num(L.latitude), lo = num(L.longitude); if (la == null || !inBox(bx, la, lo)) continue;
        const a = along(line, la, lo); if (a.d > 1500) continue;
        const st = c.statusData || {};
        chains.push({ src: 'Caltrans', route: L.route, place: L.locationName || L.nearbyPlace, dir: L.direction, lat: la, lon: lo, frac: a.frac,
          status: String(st.status || ''), text: st.statusDescription || '', time: [st.statusTimestamp?.statusDate, st.statusTimestamp?.statusTime].filter(Boolean).join(' '), inService: c.inService });
      }
    }).catch((e) => errors.push(`cc d${d}: ${e.message}`)),
    get(`https://cwwp2.dot.ca.gov/data/d${d}/lcs/lcsStatusD${dd(d)}.json`).then((j) => {
      const now = Date.now();
      for (const x of j.data || []) {
        const c = x.lcs; const b = c?.location?.begin; const cl = c?.closure; if (!b || !cl) continue;
        const la = num(b.beginLatitude), lo = num(b.beginLongitude); if (la == null || !inBox(bx, la, lo)) continue;
        const a = along(line, la, lo); if (a.d > 1000) continue;
        const ts = cl.closureTimestamp || {};
        const start = Date.parse(`${ts.closureStartDate}T${ts.closureStartTime || '00:00'}`), end = ts.isClosureEndIndefinite === 'true' ? Infinity : Date.parse(`${ts.closureEndDate}T${ts.closureEndTime || '23:59'}`);
        if (Number.isFinite(start) && (start > now + 18 * 3600e3 || end < now)) continue; // only now / next 18 h
        const full = /full/i.test(cl.typeOfClosure || '') ;
        closures.push({ src: 'Caltrans', route: b.beginRoute, place: b.beginLocationName || b.beginNearbyPlace, lat: la, lon: lo, frac: a.frac, full,
          text: [cl.typeOfClosure, cl.typeOfWork, cl.lanesClosed && `${cl.lanesClosed} lane(s)`].filter(Boolean).join(' · '), delay: cl.estimatedDelay, start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null });
      }
    }).catch((e) => errors.push(`lcs d${d}: ${e.message}`)),
    get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd(d)}.json`).then((j) => {
      for (const x of j.data || []) {
        const c = x.cctv; const L = c?.location; if (!L || c.inService === 'false') continue;
        const la = num(L.latitude), lo = num(L.longitude); if (la == null || !inBox(bx, la, lo)) continue;
        const a = along(line, la, lo); if (a.d > 800) continue;
        const img = c.imageData?.static?.currentImageURL; if (!img) continue;
        cams.push({ src: 'Caltrans', name: L.locationName || L.nearbyPlace, route: L.route, lat: la, lon: lo, frac: a.frac, img, video: c.imageData?.streamingVideoURL || null });
      }
    }).catch((e) => errors.push(`cctv d${d}: ${e.message}`)),
  ]));
  return { chains, closures, cams, errors };
}

// ---------- Washington (WSDOT public ArcGIS) ----------
const WA = [45.5, -124.9, 49.1, -116.9];
const arc = (svc, layer, bx) => `https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/${svc}/FeatureServer/${layer}/query?` + new URLSearchParams({
  where: '1=1', outFields: '*', f: 'json', returnGeometry: 'true', outSR: '4326', inSR: '4326', geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects',
  geometry: `${bx.minLon},${bx.minLat},${bx.maxLon},${bx.maxLat}` });
const ptOf = (g) => (g && Number.isFinite(g.y) ? [g.y, g.x] : g?.paths?.[0]?.[0] ? [g.paths[0][0][1], g.paths[0][0][0]] : null);
async function wsdot(bx, line) {
  const passes = [], alerts = [], cams = [], errors = [];
  if (!overlaps(bx, ...WA)) return { passes, alerts, cams, errors };
  await Promise.all([
    get(arc('TravelInfoMtPassReports', 0, bx)).then((j) => {
      for (const f of j.features || []) {
        const p = ptOf(f.geometry); if (!p) continue; const a = along(line, ...p); if (a.d > 3000) continue;
        const A = f.attributes;
        passes.push({ src: 'WSDOT', name: A.PassName, elevFt: num(A.Elevation), weather: A.Weather, road: A.RoadCondition, lat: p[0], lon: p[1], frac: a.frac,
          restrictions: [[A.TravelDirection1, A.PublicMessage1], [A.TravelDirection2, A.PublicMessage2]].filter(([, m]) => m).map(([d, m]) => ({ dir: d, text: m })), updated: A.DisplayDate });
      }
    }).catch((e) => errors.push(`wa passes: ${e.message}`)),
    get(arc('TravelInfoRoadAlerts', 0, bx)).then((j) => {
      for (const f of j.features || []) {
        const p = ptOf(f.geometry); if (!p) continue; const a = along(line, ...p); if (a.d > 800) continue;
        const A = f.attributes;
        alerts.push({ src: 'WSDOT', route: A.Road, text: A.HeadlineMessage, kind: A.EventCategoryDescription, closed: /y|true|1/i.test(String(A.RoadClosedFlag ?? '')), lat: p[0], lon: p[1], frac: a.frac });
      }
    }).catch((e) => errors.push(`wa alerts: ${e.message}`)),
    get(arc('TravelInfoCamerasWeather', 0, bx)).then((j) => {
      for (const f of j.features || []) {
        const p = ptOf(f.geometry); if (!p) continue; const a = along(line, ...p); if (a.d > 800) continue;
        const A = f.attributes; if (!A.ImageURL) continue;
        cams.push({ src: 'WSDOT', name: A.CameraTitle, lat: p[0], lon: p[1], frac: a.frac, img: A.ImageURL });
      }
    }).catch((e) => errors.push(`wa cams: ${e.message}`)),
  ]);
  return { passes, alerts, cams, errors };
}

// ---------- British Columbia (DriveBC) ----------
const BC = [48.2, -139.1, 60.1, -114.0];
async function drivebc(bx, line) {
  const alerts = [], cams = [], errors = [];
  if (!overlaps(bx, ...BC)) return { alerts, cams, errors };
  await Promise.all([
    get(`https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&limit=500&bbox=${bx.minLon},${bx.minLat},${bx.maxLon},${bx.maxLat}`).then((j) => {
      for (const e of j.events || []) {
        const g = e.geography; const p = g?.type === 'Point' ? [g.coordinates[1], g.coordinates[0]] : g?.coordinates?.[0] ? [g.coordinates[0][1], g.coordinates[0][0]] : null;
        if (!p) continue; const a = along(line, ...p); if (a.d > 1500) continue;
        const road = e.roads?.[0] || {};
        alerts.push({ src: 'DriveBC', route: road.name, text: e.description || e.headline, kind: `${e.event_type}${e.severity ? ` · ${e.severity}` : ''}`, closed: /CLOSED/i.test(road.state || ''), lat: p[0], lon: p[1], frac: a.frac });
      }
    }).catch((e) => errors.push(`bc events: ${e.message}`)),
    get('https://www.drivebc.ca/api/webcams/', 12000).then((j) => {
      for (const c of Array.isArray(j) ? j : j.webcams || []) {
        const co = c.location?.coordinates; if (!co || c.is_on === false || c.should_appear === false) continue;
        const la = num(co[1]), lo = num(co[0]); if (la == null || !inBox(bx, la, lo)) continue;
        const a = along(line, la, lo); if (a.d > 800) continue;
        const rel = c.links?.imageDisplay || `/images/${c.id}.jpg`;
        cams.push({ src: 'DriveBC', name: c.name, route: c.highway ? `Hwy ${c.highway}` : '', lat: la, lon: lo, frac: a.frac, img: rel.startsWith('http') ? rel : `https://www.drivebc.ca${rel}` });
      }
    }).catch((e) => errors.push(`bc cams: ${e.message}`)),
  ]);
  return { alerts, cams, errors };
}

// Even coverage along the drive: at most a few cams per stretch, weighted toward the mountain end.
function spread(cams, max) {
  if (cams.length <= max) return cams;
  const buckets = 12, per = Math.ceil(max / buckets), out = [];
  for (let b = 0; b < buckets; b++) {
    const lo = b / buckets, hi = (b + 1) / buckets;
    const inB = cams.filter((c) => c.frac >= lo && (c.frac < hi || (b === buckets - 1 && c.frac <= 1)));
    const take = b >= buckets / 2 ? per + 1 : per;
    const step = Math.max(1, Math.floor(inB.length / take));
    for (let i = 0; i < inB.length && out.filter((c) => c.frac >= lo && c.frac < hi).length < take; i += step) out.push(inB[i]);
  }
  return out.slice(0, max);
}

export default async function handler(req, res) {
  const q = req.query;
  const from = [Number(q.flat), Number(q.flon)], to = [Number(q.tlat), Number(q.tlon)];
  if (![...from, ...to].every(Number.isFinite)) return res.status(400).json({ error: 'need flat, flon, tlat, tlon' });
  const key = process.env.TOMTOM_API_KEY;
  const errors = [];
  let routes = [];
  try { routes = key ? await tomtomRoutes(from, to, q.depart, key) : await osrmRoutes(from, to); }
  catch (e) { errors.push(`route: ${e.message}`); try { routes = await osrmRoutes(from, to); } catch (e2) { errors.push(`osrm: ${e2.message}`); } }
  if (!routes.length) return res.status(502).json({ error: 'No route found', errors });
  // road data near any of the route options
  const lines = routes.map((r) => thin(r.coords));
  const all = lines.flat();
  const bx = bbox(all);
  const best = lines[0];
  const [ca, wa, bc] = await Promise.all([caltrans(bx, best), wsdot(bx, best), drivebc(bx, best)]);
  errors.push(...ca.errors, ...wa.errors, ...bc.errors);
  // traffic forecast for candidate departure times (comma-separated ISO list)
  let times = [];
  if (key && q.departs) times = await tomtomTimes(from, to, String(q.departs).split(',').slice(0, 8), key);
  const byFrac = (a, b) => a.frac - b.frac;
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({
    traffic: !!key,
    routes: routes.map((r, i) => ({ ...r, coords: lines[i].map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]) })),
    chains: ca.chains.sort(byFrac), closures: ca.closures.sort(byFrac),
    passes: wa.passes.sort(byFrac), alerts: [...wa.alerts, ...bc.alerts].sort(byFrac),
    cams: spread([...ca.cams, ...wa.cams, ...bc.cams].sort(byFrac), 36),
    times, errors, fetchedAt: new Date().toISOString(),
    ...(q.debug ? { box: bx } : {}),
  });
}
