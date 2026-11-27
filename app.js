import { loadSkiArea, dist } from '/lib/skiarea.js';
import { DayTracker } from '/lib/track.js';
import { AV, ACC, HOLIDAY_ACC, holidaysOn, accLabel, DEFAULT_AV, randomAvatar, encodeAv, decodeAv, normAv, palette3d, avatarSvg, avTitle, avMove, avGnar, avRide } from '/lib/avatar.js';
import { plan, feedFor, LEVELS as AI_LEVELS, SNOW } from '/lib/plan.js';
import { stayAdvice, hotelLinks, GOALS, VEHICLE_DEFAULT, chainLevel, chainAdvice, passAdvice, pickLeave, powderPick, packList, sampleRoute, googleMapsUrl, appleMapsUrl, fmtDur } from '/lib/drive.js';
import { CATALOG, logoUrl, openingFor, passOf, PASSES, slug, RESORTS as DEFAULT_RESORTS } from '/lib/resorts.js';
import { loadResorts, sumDays, MODELS, midFt } from '/lib/snow.js';
import { fetchDetail, compass } from '/lib/detail.js';
import { foodQuery, fetchOverpass, buildFood } from '/lib/food.js';
import { getMountains, saveMountains, getFavorites, saveFavorites, uniqueId, measureElevations, searchPlaces, nearestSnotel, hasSavedMountains } from '/lib/store.js';

let RESORTS = getMountains();
let FAVS = getFavorites();
// With the "All" tab gone, Favorites is the list: make sure everything already saved shows there (one time).
if (!localStorage.getItem('wp:allmerge:v1')) {
  try { RESORTS.forEach((r) => FAVS.add(r.id)); saveFavorites(FAVS); localStorage.setItem('wp:allmerge:v1', '1'); } catch {}
}
// Pass mountains that aren't on the user's list yet (shown in the Epic / Ikon views).
const EXTRA = [];
const byId = (id) => RESORTS.find((r) => r.id === id) || EXTRA.find((r) => r.id === id);
const VIEW_KEY = 'wp:view:v1';
const LEVEL_KEY = 'wp:level:v1';
const LEVELS = { summit: 'Summit', mid: 'Mid', base: 'Base' };
const getLevel = () => { const v = localStorage.getItem(LEVEL_KEY); return LEVELS[v] ? v : 'mid'; };
const levelFt = (r, lvl = getLevel()) => (lvl === 'base' ? r.baseFt : lvl === 'mid' ? midFt(r) : r.summitFt);
const DONATE_KEY = 'wp:donate-seen:v1';
const VENMO_URL = 'https://venmo.com/u/adamjames95';

window.__wpBooted = true;
const stage = (s) => window.__wpStage?.(s);

const app = document.getElementById('app');
const refreshBtn = document.getElementById('refresh');
const CACHE_KEY = 'wp:forecast:v5';
const PREFS_KEY = 'snowline:prefs:v1';
const FRESH_MS = 30 * 60 * 1000;

let state = { data: null, fetchedAt: 0, error: null };
const snotelCache = new Map();
const SX /* shared strip scroll state */ = { x: 0, v: 0, raw: false, mode: null, target: 0, anim: 0, page: null };
const camsCache = new Map();

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inch = (v) => (v == null ? '–' : v < 0.1 ? '0"' : v < 1 ? '<1"' : `${Math.round(v)}"`);
const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`);
const ft = (v) => (v == null ? '–' : `${(Math.round(v / 100) * 100).toLocaleString()}'`);
const mph = (v) => (v == null ? '–' : `${Math.round(v)}`);
const dayDate = (iso) => new Date(`${iso}T12:00:00`);
const dow = (iso) => dayDate(iso).toLocaleDateString('en-US', { weekday: 'short' });
const dom = (iso) => dayDate(iso).getDate();
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

function getPrefs() {
  try {
    return { threshold: 6, withinDays: 3, resorts: RESORTS.map((r) => r.id), ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch { return { threshold: 6, withinDays: 3, resorts: RESORTS.map((r) => r.id) }; }
}
function setPrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {} }

function powderDay(days, prefs) {
  let best = null;
  days.slice(0, prefs.withinDays).forEach((d) => {
    if (d.snow >= prefs.threshold && (!best || d.snow > best.snow)) best = d;
  });
  return best;
}

// ---------- data ----------
function loadCached() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c?.data) state = { data: c.data, fetchedAt: c.fetchedAt, error: null };
  } catch {}
}

async function refresh(force = false) {
  if (!force && state.data && Date.now() - state.fetchedAt < FRESH_MS) return;
  refreshBtn?.classList.add('spin');
  try {
    stage('requesting forecast');
    const data = await loadAll(RESORTS, force ? { timeoutMs: 12000 } : {});
    stage('drawing');
    state = { data, fetchedAt: Date.now(), error: null };
    queueLoad(EXTRA);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, fetchedAt: state.fetchedAt })); } catch {}
  } catch (e) {
    stage('failed');
    state.error = e.message || String(e);
  } finally {
    refreshBtn?.classList.remove('spin');
    safeRender();
  }
}

/** Fetch forecasts in chunks of 8 mountains (16 points) so each request stays light. */
async function loadAll(list, extra = {}) {
  const chunks = [];
  for (let i = 0; i < list.length; i += 8) chunks.push(list.slice(i, i + 8));
  const results = await Promise.allSettled(chunks.map((c) => loadResorts(c, { onStage: stage, ...extra })));
  const data = {};
  let err = null;
  results.forEach((r) => { if (r.status === 'fulfilled') Object.assign(data, r.value); else err = r.reason; });
  if (!Object.keys(data).length && err) throw err;
  return data;
}

// ---------- forecast queue: small batches, one at a time, with retries ----------
// Open-Meteo's free tier rate-limits big parallel multi-model requests (HTTP 429), which left
// pass-view cards stuck on "Loading forecast…". Batches of 4 run one after another and failures back off and retry.
const loadQ = { ids: new Set(), running: false, fails: new Map() };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// Haptic tick. Android: Vibration API. iPhone (iOS 18+): Safari has no vibrate(), but toggling a native
// <input switch> plays the system haptic — so we click a hidden one. iOS only allows it during a touch.
const haptic = (ms = 10) => {
  try {
    if (navigator.vibrate && navigator.vibrate(ms)) return;
    // iOS 18+ Safari: toggling a native switch plays the system haptic (same trick as the ios-haptics library).
    const label = document.createElement('label'); label.ariaHidden = 'true'; label.style.display = 'none';
    const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('switch', '');
    label.appendChild(input); document.head.appendChild(label); label.click(); document.head.removeChild(label);
  } catch {}
};
let rerenderTimer = 0;
function rerenderHomeSoon() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    if (location.hash.length > 2) return;
    if (sortActive || SX.anim || document.querySelector('.swc.open')) { rerenderHomeSoon(); return; }
    renderHome();
  }, 350);
}
function queueLoad(list) {
  for (const r of list) if (r && !r.placeholder && !state.data?.[r.id] && (loadQ.fails.get(r.id) || 0) < 4) loadQ.ids.add(r.id);
  runQueue();
}
async function runQueue() {
  if (loadQ.running) return;
  loadQ.running = true;
  while (loadQ.ids.size) {
    const rs = [...loadQ.ids].slice(0, 4).map(byId).filter((r) => r && !r.placeholder);
    [...loadQ.ids].slice(0, 4).forEach((id) => loadQ.ids.delete(id));
    if (!rs.length) continue;
    try {
      const d = await loadResorts(rs, { onStage: stage });
      state.data = { ...(state.data || {}), ...d };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: state.data, fetchedAt: state.fetchedAt || Date.now() })); } catch {}
      rerenderHomeSoon();
      await sleep(400);
    } catch (e) {
      let n = 0;
      rs.forEach((r) => { n = (loadQ.fails.get(r.id) || 0) + 1; loadQ.fails.set(r.id, n); if (n < 4) loadQ.ids.add(r.id); });
      await sleep(/429|limit|too many/i.test(String(e?.message)) ? 15000 * n : 2500 * n);
      if (n >= 4) rerenderHomeSoon();
    }
  }
  loadQ.running = false;
}

/** Load one newly added mountain and merge it in. */
async function loadOne(r) {
  try {
    const d = await loadResorts([r], { onStage: stage });
    state.data = { ...(state.data || {}), ...d };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: state.data, fetchedAt: state.fetchedAt || Date.now() })); } catch {}
  } catch (e) { console.warn(e); }
}

function safeRender() {
  try { render(); }
  catch (e) {
    console.error(e);
    app.innerHTML = `<div class="pad"><p class="err">Something broke while drawing the page:</p><pre class="small" style="white-space:pre-wrap">${esc(e && (e.stack || e.message) || e)}</pre><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}
window.addEventListener('error', (e) => { if (!state.data) app.innerHTML = `<p class="pad err">Error: ${esc(e.message)}</p>`; });
window.addEventListener('unhandledrejection', (e) => { if (!state.data) app.innerHTML = `<p class="pad err">Error: ${esc(e.reason?.message || e.reason)}</p>`; });

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---------- views ----------
function render() {
  const [, view, id, sub, arg] = (location.hash || '#/').split('/');
  document.body.classList.toggle('detail', view === 'resort');
  if (view === 'resort' && byId(id) && sub === 'daily') return renderDaily(byId(id));
  if (view === 'resort' && byId(id) && sub === 'hourly') return renderHourly(byId(id), arg);
  if (view === 'resort' && byId(id) && sub === 'map') return renderMapFull(byId(id));
  if (view === 'resort' && byId(id) && sub === 'trailmap') return renderTrailMapImage(byId(id), arg);
  if (view === 'resort' && byId(id)) return renderResort(byId(id));
  if (view === 'settings') return renderSettings();
  if (view === 'manage') return renderManage();
  if (view === 'ai') return renderAI();
  if (view === 'drive') return renderDrive();
  renderHome();
}

// Shared bar scale across all resorts (history + 15-day forecast) so heights compare honestly.
function sharedScale() {
  return Math.max(12, ...shownList().list.concat(location.hash.startsWith('#/resort/') ? [byId(location.hash.split('/')[2])].filter(Boolean) : []).flatMap((r) => {
    const s = state.data?.[r.id]?.[getLevel()];
    return s ? [...historyDays(r, s).map((d) => d.snow), ...s.days.slice(0, 15).map((d) => d.snow)] : [];
  }));
}

/** Past days: SNOTEL-reported daily new snow when available, otherwise modeled. */
function historyDays(r, s) {
  const obs = snotelCache.get(r.id);
  const rep = new Map((obs && !obs.error && obs.daily ? obs.daily : []).map((d) => [d.date, d.newIn]));
  return (s.history || []).slice(-15).map((d) => {
    const v = rep.get(d.date);
    return v != null ? { date: d.date, snow: v, src: 'rep' } : { date: d.date, snow: d.snow, mixed: d.mixed, src: 'est' };
  });
}

function shownList() {
  let view = localStorage.getItem(VIEW_KEY) || 'fav';
  if (view !== 'fav' && !PASSES[view]) { view = 'fav'; localStorage.setItem(VIEW_KEY, 'fav'); } // the old "All" tab is gone
  const favs = RESORTS.filter((r) => FAVS.has(r.id));
  let list = view === 'fav' ? favs : RESORTS;
  if (PASSES[view]) {
    ensurePass(view);
    list = [...RESORTS.filter((r) => passOf(r) === view), ...EXTRA.filter((r) => r.pass === view)];
  }
  return { view, list: sortList(list), favCount: favs.length };
}

// ---------- Epic / Ikon views: every mountain on the pass, including ones not on your list ----------
const PASSMTN_KEY = 'wp:passmtn:v1';
const passBuilding = new Set();
const onList = (c) => RESORTS.some((r) => r.name === c.name || (Math.abs(r.lat - c.lat) < 0.02 && Math.abs(r.lon - c.lon) < 0.02));
function ensurePass(pass) {
  if (passBuilding.has(pass) || passBuilding.has(`${pass}:done`)) return;
  passBuilding.add(pass);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PASSMTN_KEY) || '{}'); } catch {}
  const todo = CATALOG.filter((c) => c.pass === pass && !onList(c) && !EXTRA.some((x) => x.name === c.name));
  // Show every mountain right away (placeholder until its elevations are measured), then fill in.
  for (const c of todo) {
    const m = saved[c.name] ? { ...saved[c.name], opening: c.opening, openingEst: c.openingEst } : { id: `x-${slug(c.name)}`, name: c.name, state: c.state, country: c.country, lat: c.lat, lon: c.lon, site: c.site, pass, placeholder: true };
    m.pass = pass; m.extra = true;
    EXTRA.push(m);
  }
  (async () => {
    const pending = EXTRA.filter((m) => m.pass === pass && m.placeholder);
    const show = () => { if (location.hash.length <= 2 && localStorage.getItem(VIEW_KEY) === pass && !sortActive && !SX.anim) renderHome(); };
    const loadData = async () => queueLoad(EXTRA.filter((m) => m.pass === pass && !m.placeholder));
    await loadData(); // mountains measured on an earlier visit
    show();
    for (let i = 0; i < pending.length; i += 8) {
      await Promise.all(pending.slice(i, i + 8).map(async (m) => {
        const c = CATALOG.find((x) => x.name === m.name);
        const built = await buildMountain(c, RESORTS).catch(() => null);
        if (!built) return;
        Object.assign(m, built, { id: m.id, pass, extra: true, placeholder: false, custom: true });
        saved[m.name] = { ...m };
      }));
      try { localStorage.setItem(PASSMTN_KEY, JSON.stringify(saved)); } catch {}
      await loadData(); // fill cards in as each batch is ready
      show();
    }
    passBuilding.delete(pass); passBuilding.add(`${pass}:done`);
    show();
  })();
}
// Adding a pass mountain to your list (starring it in the Epic/Ikon view).
function adoptExtra(id) {
  const i = EXTRA.findIndex((m) => m.id === id);
  if (i < 0 || EXTRA[i].placeholder) return false;
  const [m] = EXTRA.splice(i, 1);
  const { extra, placeholder, ...keep } = m;
  RESORTS.push(keep); saveMountains(RESORTS);
  FAVS.add(m.id); saveFavorites(FAVS);
  return true;
}

// ---------- sorting ----------
const SORT_KEY = 'wp:sort:v1';
const SORTS = { order: 'My order', drive: 'Closest drive', depth: 'Deepest base', recent: 'Most new snow (72 h)', best: 'Best snow per drive hour' };
const SORT_SHORT = { order: 'My order', drive: 'Closest', depth: 'Deepest', recent: 'New snow', best: 'Best for drive' };
const getSort = () => { const v = localStorage.getItem(SORT_KEY); return SORTS[v] ? v : 'order'; };
const HOME_KEY = 'wp:home:v1';
const getHome = () => { try { return JSON.parse(localStorage.getItem(HOME_KEY) || 'null'); } catch { return null; } };
const setHome = (h) => { try { localStorage.setItem(HOME_KEY, JSON.stringify(h)); } catch {} driveCache.clear(); };
const driveCache = new Map(); // id -> { min, km, est }

function depthOf(r) {
  if (hasStationDepth(r)) return snotelCache.get(r.id).depthIn;
  const v = modelDepth.get(r.id);
  return v == null ? null : v;
}
function recentOf(r) {
  const o = snotelCache.get(r.id);
  if (o && !o.error && o.new72In != null) return o.new72In;
  const s = state.data?.[r.id]?.[getLevel()];
  return s?.current?.modeled72In ?? null;
}
const driveOf = (r) => driveCache.get(r.id)?.min ?? null;
// Snow worth driving for: fresh snow counts most, base depth a little, divided by hours behind the wheel (min 1 h).
function bestScore(r) {
  const fresh = recentOf(r) || 0, depth = depthOf(r) || 0, min = driveOf(r);
  if (min == null) return null;
  return (3 * fresh + 0.15 * depth) / Math.max(1, min / 60);
}
function sortList(list) {
  const k = getSort();
  if (k === 'order') return list;
  const val = { drive: (r) => (driveOf(r) == null ? null : -driveOf(r)), depth: depthOf, recent: recentOf, best: bestScore }[k];
  return [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x;
  });
}
const fmtDrive = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);

/** Driving times from home to each mountain (OSRM road routing; falls back to a straight-line estimate). */
let driveBusy = false;
async function ensureDrive(list) {
  const home = getHome();
  if (!home || driveBusy) return;
  const need = list.filter((r) => !driveCache.has(r.id) && Number.isFinite(r.lat));
  if (!need.length) return;
  driveBusy = true;
  const crow = (r) => {
    const R = 6371, toR = Math.PI / 180, dLat = (r.lat - home.lat) * toR, dLon = (r.lon - home.lon) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(home.lat * toR) * Math.cos(r.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  for (let i = 0; i < need.length; i += 60) {
    const batch = need.slice(i, i + 60);
    let got = null;
    try {
      const coords = [[home.lon, home.lat], ...batch.map((r) => [r.lon, r.lat])].map((c) => c.map((v) => v.toFixed(5)).join(',')).join(';');
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = await res.json();
      if (j.code === 'Ok') got = j;
    } catch {}
    batch.forEach((r, k) => {
      const sec = got?.durations?.[0]?.[k + 1];
      if (sec != null) driveCache.set(r.id, { min: sec / 60, km: (got.distances?.[0]?.[k + 1] || 0) / 1000 });
      else { const km = crow(r); driveCache.set(r.id, { min: ((km * 1.25) / 90) * 60, km, est: true }); } // straight line × 1.25 at ~55 mph
    });
  }
  driveBusy = false;
  if (location.hash.length <= 2) renderHome();
}

// Starting point picker: type an address, town or ZIP (with suggestions), or use the phone's location.
async function addressSearch(q, near) {
  const u = new URLSearchParams({ q, limit: '6', lang: 'en' });
  if (near) { u.set('lat', near.lat); u.set('lon', near.lon); }
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const j = await (await fetch(`https://photon.komoot.io/api/?${u}`, { signal: ctrl.signal })).json();
    return (j.features || []).map((f) => {
      const p = f.properties || {}, [lon, lat] = f.geometry.coordinates;
      const line1 = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || '';
      const line2 = [p.city || p.town || p.village || p.county, p.state, p.postcode].filter(Boolean).join(', ');
      return { lat, lon, label: [line1, p.city || p.town || p.village].filter(Boolean).join(', ') || line2, line1: line1 || line2, line2: line1 ? line2 : (p.country || '') };
    }).filter((x) => x.label);
  } catch { return []; } finally { clearTimeout(t); }
}
function askHome() {
  return new Promise((resolve) => {
    const cur = getHome();
    const m = modal(`<div class="cam-h"><b>Starting point</b><button class="circ sm" id="sp-x" aria-label="Close">✕</button></div>
      <input id="sp-q" class="sp-input" type="search" inputmode="search" autocomplete="street-address" placeholder="Address, town or ZIP" value="" />
      <button class="btn sp-gps" id="sp-gps">📍 Use my current location</button>
      <div id="sp-res" class="sp-res">${cur ? `<p class="small muted">Now: ${esc(cur.label)}</p>` : ''}</div>`);
    const input = m.querySelector('#sp-q'), res = m.querySelector('#sp-res');
    let done = false, timer = 0, seq = 0;
    const finish = (h) => { if (done) return; done = true; m.remove(); if (h) setHome({ lat: h.lat, lon: h.lon, label: h.label, ...(h.gps ? { gps: true, at: Date.now() } : {}) }); resolve(h || null); };
    m.querySelector('#sp-x').onclick = () => finish(null);
    m.addEventListener('click', (e) => { if (e.target === m) finish(null); });
    setTimeout(() => input.focus(), 50);
    const show = (items, msg) => {
      res.innerHTML = items.length ? items.map((x, k) => `<button class="sp-item" data-k="${k}"><b>${esc(x.line1)}</b><span class="small muted">${esc(x.line2 || '')}</span></button>`).join('') : `<p class="small muted">${esc(msg || 'No matches yet — try adding the city or ZIP.')}</p>`;
      res.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => finish(items[Number(b.dataset.k)])));
    };
    const search = async () => {
      const q = input.value.trim(); if (q.length < 3) { res.innerHTML = ''; return; }
      const my = ++seq;
      let items = await addressSearch(q, cur);
      if (!items.length) { const z = await locate(q).catch(() => null); if (z) items = [{ ...z, line1: z.label, line2: '' }]; }
      if (my === seq) show(items);
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 300); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); search(); } });
    m.querySelector('#sp-gps').onclick = () => {
      if (!navigator.geolocation) return show([], 'Location isn\'t available on this device.');
      res.innerHTML = '<p class="small muted">Finding you…</p>';
      navigator.geolocation.getCurrentPosition(
        async (p) => finish({ lat: p.coords.latitude, lon: p.coords.longitude, label: (await placeName(p.coords.latitude, p.coords.longitude)) || 'your location', gps: true }),
        () => show([], 'Couldn\'t get your location — allow it in Settings, or type an address.'),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    };
  });
}

// Patch the home page in place: unchanged cards keep their DOM (strips, scroll, images), so
// background updates (pass mountains measured, forecasts arriving, re-sorts) don't flash or jump.
function morphHome(html) {
  const t = document.createElement('template'); t.innerHTML = html.trim();
  const sigOf = (el) => el.outerHTML;
  const old = new Map(), oldOther = [];
  for (const el of [...app.children]) (el.classList.contains('swc') && el.dataset.id ? old.set(el.dataset.id, el) : oldOther.push(el));
  const final = [...t.content.children].map((n) => {
    if (n.classList.contains('swc') && n.dataset.id) {
      const o = old.get(n.dataset.id); old.delete(n.dataset.id);
      if (o && o.dataset.sig === sigOf(n) && !o.classList.contains('removing')) return o;
      if (o) { // card text changed: take the new card but keep the already-drawn snow strip (no re-draw / flash)
        const sig = sigOf(n), os = o.querySelector('.scroller[data-strip]'), ns = n.querySelector('.scroller[data-strip]');
        if (os && ns && os.dataset.mounted) ns.replaceWith(os);
        n.dataset.sig = sig; return n;
      }
    } else {
      const i = oldOther.findIndex((o) => o.dataset.sig === sigOf(n));
      if (i >= 0) return oldOther.splice(i, 1)[0];
    }
    n.dataset.sig = sigOf(n); return n;
  });
  final.forEach((n, i) => { if (app.children[i] !== n) app.insertBefore(n, app.children[i] || null); });
  const keep = new Set(final);
  [...app.childNodes].forEach((c) => { if (!keep.has(c)) c.remove(); });
}

// Re-sort when depths / snow reports / drive times arrive (debounced, never mid-gesture).
let resortTimer = 0;
function scheduleResort() {
  if (getSort() === 'order') return;
  clearTimeout(resortTimer);
  resortTimer = setTimeout(() => {
    if (location.hash.length > 2 || sortActive || SX.anim) return;
    const want = shownList().list.map((r) => r.id).join(','); // only redraw if the order actually changed
    const have = [...app.querySelectorAll('.swc[data-id]')].map((e) => e.dataset.id).join(',');
    if (want !== have) renderHome();
  }, 700);
}

const delBtn = (r) => (r.extra || (localStorage.getItem(VIEW_KEY) || 'fav') !== 'fav' ? '' : `<button class="sw-del" data-del="${r.id}" aria-label="Remove ${esc(r.name)}">🗑<span>Remove</span></button>`);
function removeMountain(id) {
  const i = RESORTS.findIndex((r) => r.id === id);
  if (i < 0) return;
  RESORTS.splice(i, 1); saveMountains(RESORTS);
  FAVS.delete(id); saveFavorites(FAVS);
  const p = getPrefs(); p.resorts = p.resorts.filter((x) => x !== id); setPrefs(p); syncSub();
}
const PASS_ICON = { epic: 'https://www.google.com/s2/favicons?domain=epicpass.com&sz=64', ikon: 'https://www.google.com/s2/favicons?domain=ikonpass.com&sz=64' };
const passMark = (p) => `<img class="passico" src="${PASS_ICON[p]}" alt="" onerror="this.remove()" />`;
const IKON_WORD = '<img class="ikonword" src="/icons/ikon-word.png" alt="Ikon" />';
const EPIC_WORD = '<img class="epicword" src="/icons/epic-word.png" alt="Epic" />';
const passChip = (r) => { const p = passOf(r); if (!p) return ''; return ` <span class="passchip ${p}" title="${PASSES[p]} Pass">${p === 'ikon' ? IKON_WORD : EPIC_WORD}</span>`; };
function driveChip(r) {
  const k = getSort();
  if (k !== 'drive' && k !== 'best') return '';
  const d = driveCache.get(r.id);
  return d ? `<span class="drive">🚗 ${d.est ? '~' : ''}${fmtDrive(d.min)}</span> · ` : '';
}

function renderHome() {
  if (sortActive) return; // don't redraw under a card that's being dragged
  if (!state.data) {
    app.innerHTML = state.error
      ? `<div class="pad"><p class="err">Couldn't load the forecast.</p><p class="small muted">${esc(state.error)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`
      : `<p class="pad muted">Loading forecast…</p>`;
    return;
  }
  const prefs = getPrefs();
  let { view, list, favCount } = shownList();
  const cards = list.map((r) => { try { return homeCard(r, prefs); } catch (e) {
    console.error('card', r.id, e);
    return `<div class="swc" data-id="${r.id}">${delBtn(r)}<a class="card rc" href="#/resort/${r.id}"><div class="rc-head"><div class="rc-title"><h2>${esc(r.name)}</h2><div class="sub">Tap for the full forecast</div></div></div></a></div>`;
  } }).join('');
  function homeCard(r, prefs) {
    const s = state.data[r.id]?.[getLevel()];
    const star = `<button class="star ${FAVS.has(r.id) ? 'on' : ''}" data-star="${r.id}" aria-label="${FAVS.has(r.id) ? 'Remove from' : 'Add to'} favorites">${FAVS.has(r.id) ? '★' : '☆'}</button>`;
    if (!s) {
      return `<div class="swc" data-id="${r.id}">${delBtn(r)}<div class="card rc"><div class="rc-head">${badge(r)}<div class="rc-title"><h2>${esc(r.name)}${passChip(r)}</h2><div class="sub">${esc(r.state || r.country || '')} · ${(loadQ.fails.get(r.id) || 0) >= 4 ? 'Forecast unavailable right now — pull down to retry' : 'Loading forecast…'}</div></div>${star}</div></div></div>`;
    }
    const pd = prefs.resorts.includes(r.id) ? powderDay(s.days, prefs) : null;
    const wx = weatherNow(s);
    return `
      <div class="swc" data-id="${r.id}">${delBtn(r)}<a class="card rc${wx ? ' snowing' : ''}" href="#/resort/${r.id}">
        ${wx ? precipFx(wx) : ''}
        <div class="rc-head">
          ${badge(r, 'sm')}
          <div class="rc-title">
            <h2><span class="rc-name">${esc(r.name)}</span>${passChip(r)}</h2>
            <div class="sub">${driveChip(r) || `<span title="${LEVELS[getLevel()]} elevation">${Number(levelFt(r) || 0).toLocaleString()}′</span> · `}<span title="${esc(r.state || r.country || '')}">${esc(placeAbbr(r))}</span><span class="depth" id="depth-${r.id}">${depthChip(r)}</span>${wx ? ` · <span class="wxmini ${wx.kind}" title="${esc(wx.label)} now">${WX_ICON[wx.kind]} ${WX_SHORT[wx.kind]}</span>` : ''}</div>
            <div class="mstatus" id="status-${r.id}">${statusLine(r)}</div>
          </div>
          <div class="rc-side">${star}${pd ? `<span class="powmini" title="Powder alert: ${inch(pd.snow)} ${dow(pd.date)}">❄${inch(pd.snow)}<b>${dow(pd.date)}</b></span>` : ''}</div>
        </div>
        <div class="scroller compact" data-strip="${r.id}"></div>
      </a></div>`;
  }
  const empty = view === 'fav' && !favCount
    ? `<div class="card pad"><p>No favorites yet.</p><p class="small muted">Add mountains with <b>+</b>, or star ☆ one in the Epic or Ikon view.</p></div>`
    : !RESORTS.length ? `<div class="card pad"><p>No mountains yet.</p><a class="btn primary" href="#/manage">Add mountains</a></div>` : '';
  const lvl = getLevel();
  const sortKey = getSort(), home = getHome(), needsHome = sortKey === 'drive' || sortKey === 'best';
  const html = `${holidayBanner()}
    <div class="homebar">
      <div class="seg-ctl views" role="tablist">
        <button data-view="fav" class="${view === 'fav' ? 'on' : ''}">★ Favs</button>
        <button data-view="epic" class="pass-epic ${view === 'epic' ? 'on' : ''}" aria-label="Epic">${view === 'epic' ? EPIC_WORD : 'Epic'}</button>
        <button data-view="ikon" class="pass-ikon ${view === 'ikon' ? 'on' : ''}" aria-label="Ikon">${view === 'ikon' ? IKON_WORD : 'Ikon'}</button>
      </div>
      <a class="addbtn" href="#/manage" aria-label="Add or remove mountains" title="Add or remove mountains">+</a>
    </div>
    <div class="toolbar">
      <div class="levelbar mini" role="radiogroup" aria-label="Forecast elevation">
        <button data-level="summit" class="${lvl === 'summit' ? 'on' : ''}" role="radio" aria-checked="${lvl === 'summit'}">Summit</button>
        <button data-level="mid" class="${lvl === 'mid' ? 'on' : ''}" role="radio" aria-checked="${lvl === 'mid'}">Mid</button>
        <button data-level="base" class="${lvl === 'base' ? 'on' : ''}" role="radio" aria-checked="${lvl === 'base'}">Base</button>
      </div>
      <label class="sortpill" aria-label="Sort mountains">⇅ <span>${SORT_SHORT[sortKey]}</span>
        <select id="sortby">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === sortKey ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
    </div>
    <div class="updated">${[
      PASSES[view] ? `${list.length} ${PASSES[view]} mountains${passBuilding.has(view) ? ' (loading…)' : ''}` : '',
      needsHome ? `<button class="linkbtn" id="sethome">📍 ${home ? esc(home.label) : 'Set start'}</button>` : '',
      `Updated ${ago(state.fetchedAt)}`,
      state.error ? '<span class="err">refresh failed</span>' : '',
    ].filter(Boolean).join(' · ')}</div>
    ${empty}${cards}
    ${list.length ? legendKey() : ''}
    <p class="support"><a href="#" id="replay-tut">How White Powder works</a> · <a href="${VENMO_URL}" target="_blank" rel="noopener">♥ Support White Powder</a></p>`;
  const homeKey = `${view}|${lvl}|${sortKey}`;
  if (app.dataset.home === homeKey && app.querySelector('.homebar')) morphHome(html); // background update: patch only what changed
  else {
    app.innerHTML = html; app.dataset.home = homeKey;
    [...app.children].forEach((el) => { el.dataset.sig = el.outerHTML; });
  }
  const bind = (sel, ev, fn) => app.querySelectorAll(sel).forEach((el) => { if (el.dataset.b) return; el.dataset.b = '1'; el.addEventListener(ev, fn); });
  bind('#replay-tut', 'click', (e) => { e.preventDefault(); showTutorial(); });
  bind('#hol-go', 'click', () => openAvatarBuilder(null, 'acc'));
  bind('#hol-x', 'click', (e) => { e.stopPropagation(); try { localStorage.setItem(holKey(), '1'); } catch {} e.currentTarget.closest('.hol-banner')?.remove(); });

  bind('[data-view]', 'click', (e) => {
    const v = e.currentTarget.dataset.view; if (v === (localStorage.getItem(VIEW_KEY) || 'fav')) return;
    localStorage.setItem(VIEW_KEY, v); renderHome(); window.scrollTo(0, 0);
  });
  bind('[data-level]', 'click', (e) => { localStorage.setItem(LEVEL_KEY, e.currentTarget.dataset.level); renderHome(); });
  if (sortKey === 'order') sortable(app, '.swc[data-id]', { longPress: 450, onDrop: applyOrder });
  bind('[data-star]', 'click', (e) => {
    const b = e.currentTarget; e.preventDefault(); e.stopPropagation();
    if (!adoptExtra(b.dataset.star)) toggleFav(b.dataset.star);
    renderHome();
  });
  bind('[data-del]', 'click', (e) => {
    const b = e.currentTarget; e.preventDefault(); e.stopPropagation();
    const w = b.closest('.swc');
    w.classList.add('removing');
    setTimeout(() => { removeMountain(b.dataset.del); renderHome(); }, 220);
  });
  bind('#sortby', 'change', async (e) => {
    localStorage.setItem(SORT_KEY, e.target.value);
    if ((e.target.value === 'drive' || e.target.value === 'best') && !getHome()) await askHome();
    renderHome();
  });
  bind('#sethome', 'click', async () => { if (await askHome()) renderHome(); });
  if (needsHome) ensureDrive(list);
  mountStrips(false);
  list = list.filter((r) => !r.placeholder);
  list.forEach((r) => loadObs(r).then(async () => {
    mountStrips(false, r.id);
    if (!hasStationDepth(r)) await loadModelDepth(r);
    const el = document.getElementById(`depth-${r.id}`);
    if (el) el.innerHTML = depthChip(r);
    scheduleResort();
  }));
  list.forEach((r) => loadStatus(r).then(() => {
    const el = document.getElementById(`status-${r.id}`);
    if (el) el.innerHTML = statusLine(r);
  }));
  queueLoad(list.filter((r) => !state.data[r.id]?.[getLevel()]));
}

/** What's falling right now, and how hard (inches of snow per hour; blizzard = heavy snow + strong gusts). */
function weatherNow(s) {
  const c = s.current || {};
  const snow = c.snowNowIn || 0, liq = c.nowPrecip?.liquidIn || 0, rain = c.nowPrecip?.rainShare || 0;
  if (liq >= 0.01 && rain > 0.25 && rain <= 0.85) return { kind: 'mix', label: 'Rain/snow', n: 12 };
  if (snow < 0.02 || rain > 0.85) return null;
  if (snow >= 0.3 && (c.gustMph || 0) >= 35) return { kind: 'blizzard', label: 'Blizzard', n: 40 };
  if (snow >= 0.5) return { kind: 'heavy', label: 'Heavy snow', n: 28 };
  if (snow >= 0.15) return { kind: 'mod', label: 'Snowing', n: 16 };
  return { kind: 'light', label: 'Light snow', n: 7 };
}
function precipFx(wx) {
  const flakes = '<i></i>'.repeat(wx.n);
  const drops = wx.kind === 'mix' ? '<b></b>'.repeat(12) : '';
  return `<div class="flakes ${wx.kind}" aria-hidden="true">${flakes}${drops}</div>`;
}

function toggleFav(id) {
  FAVS.has(id) ? FAVS.delete(id) : FAVS.add(id);
  saveFavorites(FAVS);
}

function legendKey() {
  return `<div class="key"><span><i style="background:var(--snow)"></i>Snow</span><span><i style="background:var(--mixed)"></i>Rain/snow mix</span></div>`;
}

function badge(r, cls = '') {
  const initials = r.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
  return `<div class="badge ${cls}" aria-hidden="true">${esc(initials)}<img src="${logoUrl(r)}" alt="" loading="lazy" onerror="this.remove()"/></div>`;
}

/** (Re)render every strip container on the page, keeping scroll position after the first mount. */
function mountStrips(labels, onlyId) {
  const scale = sharedScale();
  queueMicrotask(applyX);
  document.querySelectorAll('[data-strip]').forEach((el) => {
    const r = byId(el.dataset.strip);
    if (!r || (onlyId && r.id !== onlyId)) return;
    const s = state.data[r.id]?.[getLevel()];
    if (!s) return;
    const first = !el.dataset.mounted;
    const sk = `${typeof scale === 'object' ? JSON.stringify(scale) : scale}`;
    if (!first && !onlyId && el._s === s && el.dataset.scale === sk) return; // unchanged: leave it alone
    el._s = s; el.dataset.scale = sk;
    const compact = el.classList.contains('compact');
    el.innerHTML = snowStrip(historyDays(r, s), s.days.slice(0, 15), last24Box(r, s, compact), scale, labels || el.dataset.labels === '1', compact);
    const histW = el.querySelector('.seg.hist')?.offsetWidth || 0;
    const home = Math.max(0, histW - (compact ? 8 : 18)); // resting spot: a sliver of history peeking, then Last 24 Hours
    el.dataset.home = String(home);
    if (first && SX.page !== location.hash) { SX.page = location.hash; SX.x = home; SX.v = 0; SX.raw = false; }
    el.dataset.mounted = '1';
  });
}

// ---------- open / closed status ----------
// Live lift counts from Liftie (reads each resort's own lift-status feed), plus the announced opening date.
const statusCache = new Map();
async function loadStatus(r) {
  const c = statusCache.get(r.id);
  if (c && Date.now() - c.at < 5 * 60e3) return c.data;
  if (!r.liftie) { statusCache.set(r.id, { at: Date.now(), data: { found: false } }); return { found: false }; }
  const q = `id=${encodeURIComponent(r.liftie)}`;
  let data;
  try { data = await getJSON(`/api/status?${q}`); } catch { data = { error: true }; }
  statusCache.set(r.id, { at: Date.now(), data });
  return data;
}

const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

// Lift hours: from the resort's feed when it publishes them, else known/typical hours (minutes after midnight).
const HOURS = { kirkwood: [540, 960], palisades: [540, 960], whistler: [510, 960], stevens: [540, 960], crystal: [540, 960] };
const hoursFor = (r) => {
  const st = statusCache.get(r.id)?.data;
  if (st?.hours?.open != null) return { open: st.hours.open, close: st.hours.close, live: true };
  const h = HOURS[r.id] || [540, 960];
  return { open: h[0], close: h[1], live: false };
};
const fmtHM = (m) => { const h = Math.floor(m / 60), mm = m % 60, h12 = ((h + 11) % 12) + 1; return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`; };
const hoursText = (r) => { const h = hoursFor(r); return `${fmtHM(h.open)}–${fmtHM(h.close)}`; };
// Most recent time lifts were running (server remembers it; this device keeps a copy too).
function lastOpenOf(r, st) {
  const key = `wp:lastopen:${r.id}`;
  let mine = null; try { mine = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
  if (st && st.open > 0) { mine = { open: st.open, total: st.total, at: new Date().toISOString() }; try { localStorage.setItem(key, JSON.stringify(mine)); } catch {} }
  const srv = st?.lastOpen || null;
  const best = [mine, srv].filter(Boolean).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null;
  return best && Date.now() - Date.parse(best.at) < 14 * 864e5 ? best : null;
}
const whenShort = (iso) => { const d = new Date(iso), t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase();
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? t : days === 1 ? `yest. ${t}` : d.toLocaleDateString('en-US', { weekday: 'short' }) + ` ${t}`; };

function statusInfo(r) {
  const st = statusCache.get(r.id)?.data;
  const op = openingFor({ ...r, opening: r.opening || (st && st.opening) || null });
  const opening = op.date;
  const last = lastOpenOf(r, st && !st.error ? st : null);
  // Season is open if the opening date has passed or lifts have actually run recently (beats a stale date).
  const seasonOpen = opening <= todayIso() || !!last;
  const future = !seasonOpen;
  const when = `${op.est ? '~' : ''}${fmtDate(opening)}`;
  const opensNote = op.typical ? 'Typical date' : op.est ? 'Projected' : 'Announced';
  const h = hoursFor(r), nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const hrs = `Lifts ${fmtHM(h.open)}–${fmtHM(h.close)}`;
  if (st && !st.error && st.found !== false && st.total > 0) {
    const why = (st.reasons || []).map((x) => `${x.text}${x.n > 1 ? ` ×${x.n}` : ''}`).join(', ');
    if (st.open > 0) {
      return { cls: 'open', text: `Open · ${st.open}/${st.total} lifts`, note: st.hold ? `${st.hold} on hold${why ? ` (${why})` : ''}` : `until ${fmtHM(h.close)}`, pctOf: [st.open, st.total] };
    }
    if (st.hold > 0) return { cls: 'hold', text: `On hold · ${st.hold} lift${st.hold > 1 ? 's' : ''} paused`, note: why || 'Usually wind or weather — check the resort' };
    if (future) return { cls: 'closed', text: `Closed · Opens ${when}`, note: opensNote };
    // Season's open but lifts aren't spinning right now (night, before opening bell): show the latest count.
    const next = nowMin < h.open ? `Opens ${fmtHM(h.open)}` : `Opens ${fmtHM(h.open)} tomorrow`;
    if (last) return { cls: 'open', text: `${last.open}/${last.total} lifts`, note: `${next} · as of ${whenShort(last.at)}`, pctOf: [last.open, last.total], idle: true };
    if (st.scheduled > 0) return { cls: 'sched', text: `${next} · ${st.scheduled} lifts scheduled`, note: hrs };
    return { cls: 'closed', text: nowMin >= h.open && nowMin < h.close ? 'Lifts closed now' : next, note: why || `season opened ${fmtDate(opening)} · ${hrs}` };
  }
  if (future) return { cls: 'closed', text: `Closed · Opens ${when}`, note: opensNote };
  if (!st) return { cls: 'muted', text: 'Checking status…' };
  if (last) return { cls: 'open', text: `${last.open}/${last.total} lifts open`, note: `last report ${whenShort(last.at)} · ${hrs}`, pctOf: [last.open, last.total], idle: true };
  return { cls: 'muted', text: `${op.est ? 'Season usually opens' : 'Season opened'} ${fmtDate(opening)}`, note: `${hrs} · live lift status unavailable` };
}

function statusLine(r) {
  const s = statusInfo(r);
  const st = statusCache.get(r.id)?.data;
  const pct = s.pctOf && s.pctOf[1] ? Math.round((s.pctOf[0] / s.pctOf[1]) * 100) : null;
  if (pct != null) return `<span class="spie${s.idle ? ' idle' : ''}" style="--p:${pct}" title="${pct}% of lifts open"></span><span class="stext ${s.cls}">${esc(s.text)}</span>${s.note ? `<span class="snote"><i class="ssep"> · </i>${esc(s.note)}</span>` : ''}`;
  return `<span class="sdot ${s.cls}"></span><span class="stext ${s.cls}">${esc(s.text)}</span>${s.note ? `<span class="snote"><i class="ssep"> · </i>${esc(s.note)}</span>` : ''}`;
}

// ---------- current snow depth ----------
// Measured depth at the nearest SNOTEL station when there is one; otherwise the forecast model's
// snow depth at the base elevation (labelled as an estimate).
const modelDepth = new Map();
const hasStationDepth = (r) => { const o = snotelCache.get(r.id); return !!(o && !o.error && o.depthIn != null); };

async function loadModelDepth(r) {
  if (modelDepth.has(r.id)) return;
  const key = `wp:depth:v1:${r.lat.toFixed(3)},${r.lon.toFixed(3)},${r.baseFt}`;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && Date.now() - saved.at < 3 * 3600e3) { modelDepth.set(r.id, saved.in); return; }
  } catch {}
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${r.lat}&longitude=${r.lon}&elevation=${Math.round(r.baseFt / 3.28084)}&current=snow_depth&timezone=auto`);
    const m = j.current?.snow_depth; // meters
    const inches = Number.isFinite(m) ? Math.round(m * 39.3701) : null;
    modelDepth.set(r.id, inches);
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), in: inches })); } catch {}
  } catch { modelDepth.set(r.id, null); }
}

const WX_ICON = { light: '🌨️', mod: '🌨️', heavy: '🌨️', blizzard: '🌬️', mix: '🌧️' };
const WX_SHORT = { light: 'Light', mod: 'Snow', heavy: 'Heavy', blizzard: 'Blizzard', mix: 'Mix' };
const ABBR = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB', 'Newfoundland and Labrador': 'NL', 'Nova Scotia': 'NS', Ontario: 'ON', Quebec: 'QC', Québec: 'QC', Saskatchewan: 'SK', Yukon: 'YT',
  Switzerland: 'CH', France: 'FR', Austria: 'AT', Italy: 'IT', Japan: 'JP', Chile: 'CL', Argentina: 'AR', Australia: 'AU', 'New Zealand': 'NZ', Germany: 'DE', Andorra: 'AD', Spain: 'ES', Norway: 'NO', Sweden: 'SE', Canada: 'CA', USA: 'US', 'United States': 'US' };
const placeAbbr = (r) => { const p = r.state || r.country || ''; return ABBR[p] || (p.length > 12 ? p.split(/[\s,]+/)[0] : p); };

function depthChip(r) {
  const o = snotelCache.get(r.id);
  if (hasStationDepth(r)) {
    return ` · <span title="Measured at ${esc(r.snotel?.name || 'nearby')} SNOTEL station${o.time ? ` · ${esc(obsTime(o.time))}` : ''}">Base <b>${o.depthIn}"</b></span>`;
  }
  if (modelDepth.has(r.id)) {
    const v = modelDepth.get(r.id);
    return v == null ? '' : ` · <span title="Forecast-model estimate at base elevation">Base <b>~${v}"</b></span>`;
  }
  return '';
}

function obsTime(iso) {
  // SNOTEL times are local station time, e.g. "2026-11-22 07:00"
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return '';
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()} ${h % 12 || 12}:${m}${h < 12 ? 'a' : 'p'}`;
}

function last24Box(r, s, compact) {
  const obs = snotelCache.get(r.id);
  const reported = obs && !obs.error && obs.new24In != null;
  const val = reported ? obs.new24In : s.current?.modeled24In;
  if (compact) {
    return `<div class="l24 c">
    <div class="l24-k">Last 24h</div>
    <div class="l24-v">${inch(val)}</div>
    <div class="l24-s ${reported ? 'rep' : 'est'}">${reported ? 'Reported ✓' : 'Estimated'}</div>
  </div>`;
  }
  return `<div class="l24">
    <div class="l24-k">Last 24 Hours</div>
    <div class="l24-v">${inch(val)}</div>
    <div class="l24-t">${esc(reported ? obsTime(obs.time) : 'Model')}</div>
    <div class="l24-s ${reported ? 'rep' : 'est'}">${reported ? 'Reported ✓' : r.snotel && !obs ? 'Loading…' : 'Estimated ⓘ'}</div>
  </div>`;
}

const DIMS = { normal: { col: 34, barH: 64 }, compact: { col: 25, barH: 36 } };
function stripCols(days, scaleMax, labels, hist, dims = DIMS.normal) {
  return days.map((d) => {
    const h = d.snow >= 0.1 ? Math.max(3, Math.round((d.snow / scaleMax) * dims.barH)) : 0;
    const weekend = [0, 6].includes(dayDate(d.date).getDay());
    const cls = d.mixed ? 'mixed' : '';
    const tip = `${dow(d.date)} ${dom(d.date)}: ${inch(d.snow)}${hist ? (d.src === 'rep' ? ' reported' : ' estimated') : ''}`;
    const lbl = labels ? `<div class="vl">${d.snow < 0.5 ? '0' : Math.round(d.snow)}</div>` : '';
    const bar = h ? `<div class="bar ${cls}" style="height:${h}px"></div>` : `<div class="bar zero ${cls}"></div>`;
    return `<div class="col ${weekend ? 'wk' : ''}" title="${tip}"${hist ? '' : ` data-date="${d.date}"`}><div class="bars">${lbl}${bar}</div><div class="dl">${dow(d.date)[0]}</div><div class="dn">${dom(d.date)}</div></div>`;
  }).join('');
}

/** Past days in blocks of 5 counted back from yesterday, oldest block on the left: Past 11-15 · Past 6-10 · Past 1-5. */
function histGroups(history, compact, grp) {
  const n = history.length, out = [];
  for (let a = 1; a <= n; a += 5) {
    const b = Math.min(n, a + 4);
    const slice = history.slice(n - b, n - a + 1);
    const total = slice.reduce((t, d) => t + (d.snow || 0), 0);
    out.unshift(grp(compact ? `Past ${a}-${b}` : `Past ${a}-${b} Days`, total, slice.length).replace('class="grp-line"', 'class="grp-line h"'));
  }
  return out.join('');
}

function snowStrip(history, days, l24, scaleMax, labels, compact) {
  const dims = compact ? DIMS.compact : DIMS.normal;
  const grp = (label, total, n) => `<div class="grp" style="width:${n * dims.col}px"><div class="grp-k">${label}</div><div class="grp-line"><span>${inch(total)}</span></div></div>`;
  const fcGroups = [0, 5, 10].filter((g) => g < days.length).map((g) => {
    const n = Math.min(5, days.length - g);
    return grp(compact ? `Days ${g + 1}-${g + n}` : `Next ${g + 1}-${g + n} Days`, sumDays(days, g, 5), n);
  }).join('');
  return `<div class="strip ${labels ? 'labels' : ''} ${compact ? 'compact' : ''}">
    ${history.length ? `<div class="seg hist"><div class="grps">${histGroups(history, compact, grp)}</div><div class="cols">${stripCols(history, scaleMax, labels, true, dims)}</div></div>` : ''}
    ${l24}
    <div class="seg fc"><div class="grps">${fcGroups}</div><div class="cols">${stripCols(days, scaleMax, labels, false, dims)}</div></div>
  </div>`;
}

function renderResort(r) {
  const d = state.data?.[r.id];
  if (!d) { renderHome(); return; }
  const s = d.summit, b = d.base;
  const models = s.modelsAvailable.map((k) => MODELS.find((m) => m.key === k)?.label).join(' · ');

  app.innerHTML = `
    <div class="dhead">
      <a class="circ" href="#/" aria-label="Back">‹</a>
      <div class="pillbar">
        <a href="#/settings" aria-label="Settings"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></a>
        <button id="share" aria-label="Share">⤴</button>
      </div>
    </div>
    <div class="dtitle">
      <div class="dtitle-row">${badge(r, 'sm')}<h1>${esc(r.name)}</h1></div>
      <div class="mstatus big" id="status-d">${statusLine(r)}</div>
      <div class="fp">Forecast Point <b>${r.summitFt.toLocaleString()} ft</b> <span class="muted">· base ${r.baseFt.toLocaleString()} ft · ${esc(r.region)}</span></div>
    </div>
    <nav class="tabs" id="tabs">
      <a href="#sec-summary" class="on">Snow Summary</a>
      <a href="#sec-cams">Cams</a>
      <a href="#sec-weather">Weather</a>
      <a href="#sec-map">Trail Map</a>
      <a href="#sec-food">Food</a>
      <a href="#sec-report">Snow Report</a>
    </nav>

    <section id="sec-summary" class="dsec">
      <div class="dsec-h"><h2>Snow Summary</h2>
        <div class="levelbar sm" role="radiogroup" aria-label="Forecast elevation">
          ${Object.entries(LEVELS).map(([k, label]) => `<button data-level="${k}" class="${getLevel() === k ? 'on' : ''}">${label} ${levelFt(r, k).toLocaleString()}'</button>`).join('')}
        </div></div>
      <div class="card flat">
        <div class="scroller" data-strip="${r.id}" data-labels="1"></div>
        <div class="ddlinks"><a class="btn sm" href="#/resort/${r.id}/daily">Detailed daily forecast ›</a><a class="btn sm" href="#/resort/${r.id}/hourly/${s.days[0]?.date || ''}">Hourly ›</a></div>
        <details class="more" id="more-chart">
          <summary>Base vs summit · model range</summary>
          <div class="legend">
            <span><i style="background:var(--summit)"></i>Summit ${r.summitFt.toLocaleString()}'</span>
            <span><i style="background:var(--base)"></i>Base ${r.baseFt.toLocaleString()}'</span>
            <span><svg width="10" height="10" style="vertical-align:-1px;margin-right:5px"><line x1="5" x2="5" y1="0" y2="10" stroke="var(--text-secondary)" stroke-width="1.5"/></svg>Model range</span>
          </div>
          <div class="chart-wrap" id="chart"></div>
          <p class="small muted">Blend of ${esc(models)}. Tap a day in this chart for details.</p>
        </details>
      </div>
      ${legendKey()}
    </section>

    <section id="sec-cams" class="dsec">
      <div class="dsec-h"><h2>Cams</h2><a href="${esc(camsLink(r))}" target="_blank" rel="noopener">${r.camsUrl ? 'Official cams' : 'Find cams'} ↗</a></div>
      <div class="card flat"><div class="camwrap" id="cams"><p class="small muted">Loading cams…</p></div></div>
    </section>

    <section id="sec-weather" class="dsec">
      <div class="dsec-h"><h2>Weather</h2></div>
      <div class="card flat">
        <div class="tiles">
          <div class="tile"><div class="k">Summit</div><div class="v">${deg(s.current?.tempF)}F</div><div class="s">Base ${deg(b.current?.tempF)}F</div></div>
          <div class="tile"><div class="k">Summit wind</div><div class="v">${mph(s.current?.windMph)} <span class="small">mph</span></div><div class="s">Gusts ${mph(s.current?.gustMph)} mph</div></div>
          <div class="tile"><div class="k">Snow level</div><div class="v">${ft(s.current?.snowLevelFt)}</div><div class="s">${snowLevelNote(s.current?.snowLevelFt, r)}</div></div>
          <div class="tile"><div class="k">Next 24 h · summit</div><div class="v">${inch(s.current?.next24In)}</div><div class="s">Base ${inch(b.current?.next24In)}</div></div>
        </div>
        <div class="table-scroll" style="margin-top:12px">${dayTable(s.days, b.days)}</div>
      </div>
    </section>

    <section id="sec-map" class="dsec">
      <div class="dsec-h"><h2>Trail Map</h2><a href="${esc(trailMapLink(r))}" target="_blank" rel="noopener">${r.trailMapUrl ? 'Official map' : 'Find official map'} ↗</a></div>
      <div class="card flat mapcard">
        <div class="tm-h">Official trail maps</div>
        <div id="tmaps" class="tmaps"><p class="small muted">Finding trail maps…</p></div>
        <div class="tm-h">Interactive ski map <span class="muted small">· runs, lifts &amp; difficulty</span></div>
        <div id="skimap" class="skimap"><p class="small muted pad">Loading ski map…</p></div>
        <div class="ddlinks" style="padding-top:8px"><a class="btn sm" href="#/resort/${r.id}/map">Full-screen ski map ›</a></div>
      </div>
    </section>

    <section id="sec-food" class="dsec">
      <div class="dsec-h"><h2>Food &amp; Drink</h2></div>
      <div class="card flat"><div id="food" class="foodwrap"><p class="small muted">Finding places…</p></div></div>
    </section>

    <section id="sec-report" class="dsec">
      <div class="dsec-h"><h2>Snow Report</h2></div>
      <div class="card flat" id="report">${reportHtml(r, s)}</div>
    </section>`;

  mountStrips(true);
  app.querySelectorAll('.dsec [data-level]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem(LEVEL_KEY, b.dataset.level);
    app.querySelectorAll('.dsec [data-level]').forEach((x) => x.classList.toggle('on', x === b));
    const el = document.querySelector('[data-strip]'); if (el) delete el.dataset.mounted; SX.page = null;
    mountStrips(true);
  }));
  document.querySelector('[data-strip]')?.addEventListener('click', (e) => {
    const c = e.target.closest('.col[data-date]');
    if (c) location.hash = `#/resort/${r.id}/hourly/${c.dataset.date}`;
  });
  loadObs(r).then(() => {
    if (location.hash !== `#/resort/${r.id}`) return;
    mountStrips(true);
    const rep = document.getElementById('report');
    if (rep) rep.innerHTML = reportHtml(r, s);
  });
  loadCams(r);
  loadFoodSection(r);
  loadStatus(r).then((st) => {
    const el = document.getElementById('status-d');
    if (!el || location.hash !== `#/resort/${r.id}`) return;
    const link = (st && st.url) || r.camsUrl || null;
    const hasLifts = st?.lifts?.length;
    el.innerHTML = statusLine(r) + (hasLifts ? ` <button class="slink linkbtn" id="liftlines">${st.hasWaits ? 'Lift lines' : 'Lifts'} ›</button>` : '') + (link ? ` <a class="slink" href="${esc(link)}" target="_blank" rel="noopener">Resort status ↗</a>` : '');
    document.getElementById('liftlines')?.addEventListener('click', () => {
      const rank = { open: 0, hold: 1, scheduled: 2, closed: 3 };
      const ls = [...st.lifts].sort((a, b) => rank[a.status] - rank[b.status] || (a.wait ?? 99) - (b.wait ?? 99));
      const m = modal(`<div class="cam-h"><b>${esc(r.name)} lifts</b><button class="circ sm" id="ll-x" aria-label="Close">✕</button></div>
        <div class="ll-list">${ls.map((l) => `<div class="ll"><span class="sdot ${l.status}"></span><span class="ll-n">${esc(l.name)}</span><span class="ll-w ${l.wait >= 10 ? 'err' : l.wait != null ? 'good' : 'muted'}">${l.status !== 'open' ? esc(l.status) : l.wait != null ? `${l.wait} min` : '—'}</span></div>`).join('')}</div>
        <p class="small muted">${st.hasWaits ? 'Wait times from the resort, updated every few minutes.' : 'This resort doesn\'t publish wait times.'}</p>`);
      m.querySelector('#ll-x').onclick = () => m.remove();
      m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    });
  });
  // Mount the map only when it's about to scroll into view (saves data).
  // Load trail maps when the section is about to scroll into view (saves data).
  const sm = document.getElementById('skimap');
  const go = () => loadTrailMaps(r);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '400px' });
    io.observe(sm);
  } else go();

  const more = document.getElementById('more-chart');
  more.addEventListener('toggle', () => { if (more.open) drawChart(document.getElementById('chart'), s.days, b.days); });

  document.getElementById('share').addEventListener('click', async () => {
    const text = `${r.name}: ${inch(sumDays(s.days, 0, 5))} next 5 days (summit)`;
    try { if (navigator.share) await navigator.share({ title: 'White Powder', text, url: location.href }); else await navigator.clipboard.writeText(`${text} ${location.href}`); } catch {}
  });

  const tabs = [...document.querySelectorAll('#tabs a')];
  tabs.forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    tabs.forEach((t) => t.classList.toggle('on', t === a));
    const sec = document.querySelector(a.getAttribute('href'));
    const y = sec.getBoundingClientRect().top + window.scrollY - document.getElementById('tabs').offsetHeight - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }));
}

const camsLink = (r) => r.camsUrl || `https://www.google.com/search?q=${encodeURIComponent(`${r.name} ${r.state || ''} ski webcam`)}`;

function snowLevelNote(level, r) {
  if (level == null) return '';
  if (level <= r.baseFt) return 'Snow to base';
  if (level >= r.summitFt) return 'Rain to summit';
  return 'Rain at base';
}

function reportHtml(r, s) {
  const obs = snotelCache.get(r.id);
  if (!r.snotel || !obs || obs.error) {
    const why = !r.snotel ? 'No SNOTEL station nearby — showing model estimates.' : !obs ? 'Loading SNOTEL…' : 'SNOTEL unavailable right now — showing model estimates.';
    return `<div class="tiles">
      <div class="tile"><div class="k">Last 24 h · estimated</div><div class="v">${inch(s.current?.modeled24In)}</div></div>
      <div class="tile"><div class="k">Last 72 h · estimated</div><div class="v">${inch(s.current?.modeled72In)}</div></div>
    </div><p class="small muted" style="margin:10px 0 0">${why}</p>`;
  }
  return `<div class="tiles">
      <div class="tile"><div class="k">Last 24 h</div><div class="v">${inch(obs.new24In)}</div></div>
      <div class="tile"><div class="k">Last 72 h</div><div class="v">${inch(obs.new72In)}</div></div>
      <div class="tile"><div class="k">Snow depth</div><div class="v">${obs.depthIn ?? '–'}"</div></div>
      <div class="tile"><div class="k">Snow water equiv.</div><div class="v">${obs.sweIn != null ? `${obs.sweIn.toFixed(1)}"` : '–'}</div></div>
    </div>
    <p class="small muted" style="margin:10px 0 0">${esc(r.snotel?.name || 'nearby')} SNOTEL · ${esc(obsTime(obs.time))}. New snow is estimated from the rise in snow depth, so it runs a little low as snow settles.</p>`;
}

const obsPending = new Map();
function loadObs(r) {
  if (!r.snotel || snotelCache.has(r.id)) return Promise.resolve();
  if (!obsPending.has(r.id)) {
    obsPending.set(r.id, getJSON(`/api/snotel?triplet=${encodeURIComponent(r.snotel.triplet)}`)
      .then((j) => snotelCache.set(r.id, j)).catch(() => snotelCache.set(r.id, { error: true })));
  }
  return obsPending.get(r.id);
}

const CAM_AUTO_KEY = 'wp:cam-autoplay:v1';
const camAutoplay = () => localStorage.getItem(CAM_AUTO_KEY) !== '0'; // on by default

async function loadCams(r) {
  const el = () => document.getElementById('cams');
  let cams = camsCache.get(r.id);
  if (!cams || Date.now() - cams.at > 8 * 60 * 1000) { // Windy free-tier image tokens expire after 10 min
    const own = (r.cams || []).map((c) => c.preview || c.embed || c.link);
    try { const j = await getJSON(`/api/webcams?lat=${r.lat}&lon=${r.lon}${own.length ? `&own=${encodeURIComponent(own.join('|'))}` : ''}`); cams = { at: Date.now(), list: j.webcams || [], ownOk: j.ownOk || [] }; }
    catch { cams = { at: Date.now(), list: [], error: true }; }
    camsCache.set(r.id, cams);
  }
  if (!el() || location.hash !== `#/resort/${r.id}`) return;
  // Resort's own cams first, then nearby cams from Windy (all with preview images where available).
  const all = [
    ...(r.cams || []).filter((c, i) => cams.ownOk?.[i] !== false).map((c) => ({ name: c.name, embed: c.embed || null, link: c.link || null, preview: c.preview || null, live: true, src: 'resort' })),
    ...cams.list.map((c) => ({ name: c.title, embed: c.embed || null, link: c.link, preview: c.image, live: !!c.live, src: c.src || 'Windy', road: !!c.road, km: c.km })),
  ];
  const tile = (c, i) => `<button class="cam embed" data-i="${i}">
      <div class="ph live">${c.preview ? `<img src="${esc(c.preview)}${c.preview.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 300000)}" alt="" loading="lazy" onerror="this.closest('.cam')?.remove()" />` : ''}<span class="play">${c.embed ? '▶' : c.preview ? '⤢' : '↗'}</span>${c.road ? `<span class="lv tl">ROAD CAM${c.km != null ? ` · ${Math.round(c.km)} km` : ''}</span>` : c.live ? '<span class="lv">LIVE</span>' : '<span class="lv tl">TIME-LAPSE</span>'}</div>
      <span>${esc(c.name)}</span>
    </button>`;
  const official = `<a class="cam official" href="${esc(camsLink(r))}" target="_blank" rel="noopener"><div class="ph">📷</div><span>${r.camsUrl ? `All ${esc(r.name)} cams` : `Search ${esc(r.name)} webcams`} ↗</span></a>`;
  // the mountain's own cams first (live player, else its snapshot), then nearby cams
  let first = all.findIndex((c) => c.src === 'resort' && c.embed);
  if (first < 0) first = all.findIndex((c) => c.src === 'resort' && c.preview);
  if (first < 0) first = all.findIndex((c) => c.embed);
  if (first < 0) first = all.findIndex((c) => c.preview);
  const auto = camAutoplay() && first >= 0;
  const snap = (u) => `${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`;
  // Live players sit on top of the cam's snapshot, so there's always a picture; if a player hasn't loaded in 8 s
  // we drop back to the snapshot (auto-refreshing) and offer the next cam.
  const feature = (c) => (c.embed
    ? `${c.preview ? `<img class="cam-poster" src="${esc(snap(c.preview))}" alt=""/>` : ''}<iframe id="cam-live" src="${esc(c.embed)}" title="${esc(c.name)} webcam" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen onload="this.dataset.ok='1'"></iframe>`
    : `<img id="cam-live" class="cam-snap" data-src="${esc(c.preview)}" src="${esc(snap(c.preview))}" alt="${esc(c.name)}"/>`);
  let cur = 0;
  const playable = all.map((c, i) => (c.embed || c.preview ? i : -1)).filter((i) => i >= 0);
  const show = (i) => {
    const c = all[i], frame = document.getElementById('cam-frame'); if (!c || !frame) return;
    cur = i; frame.innerHTML = feature(c);
    const cap = document.getElementById('cam-cap');
    if (cap) cap.innerHTML = `${esc(c.name)}${c.road ? ' · road cam' : ''} · <a href="${esc(c.link || c.embed || c.preview)}" target="_blank" rel="noopener">open ↗</a>${playable.length > 1 ? ' · <button class="linkbtn" id="cam-next">next cam ›</button>' : ''}`;
    document.getElementById('cam-next')?.addEventListener('click', () => show(playable[(playable.indexOf(cur) + 1) % playable.length]));
    const ifr = frame.querySelector('iframe');
    if (ifr) setTimeout(() => {
      if (!ifr.isConnected || ifr.dataset.ok) return;
      if (c.preview) { frame.innerHTML = feature({ ...c, embed: null }); }
      frame.insertAdjacentHTML('beforeend', `<div class="cam-stall">Live feed isn't loading${c.preview ? ' — showing the latest snapshot' : ''}.</div>`);
    }, 8000);
  };
  el().innerHTML = `
    ${auto ? `<div class="cam-feature"><div class="cam-frame" id="cam-frame"></div><div class="small muted cam-cap" id="cam-cap"></div></div>` : ''}
    <div class="camrow-in">${all.map(tile).join('')}${official}</div>
    ${!all.length ? '<p class="small muted">No cams found for this mountain yet — try the link above.</p>' : ''}
    ${cams.list.length ? `<p class="small muted" style="margin:6px 0 0">Nearby cams via ${[...new Set(cams.list.map((c) => c.src || 'Windy'))].map((x) => (x === 'Windy' ? '<a href="https://www.windy.com/webcams" target="_blank" rel="noopener">windy.com</a>' : x)).join(', ')}</p>` : ''}`;
  if (auto) show(first);
  clearInterval(loadCams.tick);
  loadCams.tick = setInterval(() => {
    const im = document.querySelector('img.cam-snap');
    if (!im || location.hash !== `#/resort/${r.id}`) { if (!document.getElementById('cams')) clearInterval(loadCams.tick); return; }
    const n = new Image(); n.onload = () => { im.src = n.src; }; n.src = snap(im.dataset.src);
  }, 30000);
  el().querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const c = all[Number(b.dataset.i)];
    if (!c.embed && c.preview && document.getElementById('cam-frame')) {
      show(Number(b.dataset.i)); document.getElementById('cam-frame').scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
    }
    if (!c.embed && c.preview) { // snapshot cams (highway / Windy without a player): enlarge in the app
      const m = modal(`<div class="cam-h"><b>${esc(c.name)}</b><button class="circ sm" id="sc-x" aria-label="Close">✕</button></div>
        <img class="ft-cam-big" src="${esc(c.preview)}${c.preview.includes('?') ? '&' : '?'}t=${Date.now()}" alt=""/>
        <p class="small muted">${esc(c.src || '')}${c.km != null ? ` · ${Math.round(c.km)} km from ${esc(r.name)}` : ''} · snapshot refreshes every few minutes${c.link && c.link !== c.preview ? ` · <a href="${esc(c.link)}" target="_blank" rel="noopener">open ↗</a>` : ''}</p>`);
      m.querySelector('#sc-x').onclick = () => m.remove(); m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
      return;
    }
    if (!c.embed) { window.open(c.link, '_blank', 'noopener'); return; }
    const frame = document.getElementById('cam-frame');
    if (frame) { show(Number(b.dataset.i)); frame.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else openCam(c.name, c.embed, r);
  }));
}

function dayTable(sd, bd) {
  const rows = sd.map((d, i) => {
    const b = bd[i];
    const range = d.nModels > 1 && d.max >= 0.5 ? `${Math.round(d.min)}–${Math.round(d.max)}"` : '–';
    return `<tr>
      <td>${dow(d.date)} ${dom(d.date)}</td>
      <td class="big">${inch(d.snow)}</td>
      <td>${inch(b?.snow)}</td>
      <td>${range}</td>
      <td>${deg(d.hiF)}/${deg(d.loF)}</td>
      <td>${ft(d.snowLevelFt)}</td>
      <td>${mph(d.gustMph)}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr><th>Day</th><th>Summit</th><th>Base</th><th>Range</th><th>Hi/Lo °F</th><th>Snow lvl</th><th>Gust</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// ---------- chart ----------
function niceMax(v) {
  const steps = [2, 4, 6, 8, 12, 16, 24, 36, 48, 72];
  return steps.find((s) => s >= v) || Math.ceil(v / 24) * 24;
}

function barPath(x, y0, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  const y = y0 - h;
  return `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y0}Z`;
}

function drawChart(el, sd, bd) {
  const colW = 19, padL = 24, padR = 6, padT = 18, plotH = 150, padB = 34;
  const n = sd.length;
  const width = Math.max(el.clientWidth || 340, padL + padR + n * colW);
  const cw = (width - padL - padR) / n;
  const maxV = niceMax(Math.max(1, ...sd.map((d) => Math.max(d.snow, d.nModels > 1 ? d.max : 0)), ...bd.map((d) => d.snow)));
  const y = (v) => padT + plotH - (v / maxV) * plotH;
  const y0 = padT + plotH;
  const barW = Math.min(9, (cw - 8) / 2);

  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (maxV / 4) * i;
    g += `<line x1="${padL}" x2="${width - padR}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="${i === 0 ? 1 : 0.6}"/>`;
    g += `<text x="${padL - 5}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}"</text>`;
  }

  const peak = sd.reduce((best, d, i) => (d.snow > (sd[best]?.snow ?? -1) ? i : best), 0);
  let marks = '', labels = '', hits = '';
  sd.forEach((d, i) => {
    const cx = padL + cw * i + cw / 2;
    const b = bd[i];
    const xs = cx - barW - 1, xb = cx + 1; // 2px surface gap between paired bars
    marks += `<path d="${barPath(xs, y0, barW, y0 - y(d.snow), 3)}" fill="var(--summit)"/>`;
    if (b) marks += `<path d="${barPath(xb, y0, barW, y0 - y(b.snow), 3)}" fill="var(--base)"/>`;
    if (d.nModels > 1 && d.max - d.min >= 0.5) {
      const wx = xs + barW / 2;
      marks += `<line x1="${wx}" x2="${wx}" y1="${y(d.min)}" y2="${y(d.max)}" stroke="var(--text-secondary)" stroke-width="1.5" stroke-linecap="round"/>`;
    }
    const weekend = [0, 6].includes(dayDate(d.date).getDay());
    labels += `<text x="${cx}" y="${y0 + 14}" text-anchor="middle" ${weekend ? 'class="lbl-strong"' : ''}>${dow(d.date).slice(0, 2)}</text>`;
    labels += `<text x="${cx}" y="${y0 + 27}" text-anchor="middle">${dom(d.date)}</text>`;
    if (i === peak && d.snow >= 1) {
      const top = Math.min(y(d.snow), d.nModels > 1 ? y(d.max) : Infinity);
      labels += `<text x="${xs + barW / 2}" y="${top - 5}" text-anchor="middle" class="lbl-strong">${inch(d.snow)}</text>`;
    }
    hits += `<rect class="hit" data-i="${i}" x="${padL + cw * i}" y="${padT - 10}" width="${cw}" height="${plotH + padB + 10}" rx="4"/>`;
  });

  el.innerHTML = `<svg width="${width}" height="${padT + plotH + padB}" role="img" aria-label="16-day snowfall forecast, summit and base">${g}${marks}${labels}${hits}</svg><div class="tooltip" hidden></div>`;

  const tip = el.querySelector('.tooltip');
  const show = (rect) => {
    el.querySelectorAll('.hit.active').forEach((h) => h.classList.remove('active'));
    rect.classList.add('active');
    const i = +rect.dataset.i, d = sd[i], b = bd[i];
    const modelRows = Object.entries(d.models).filter(([, v]) => v != null)
      .map(([k, v]) => `<div class="tt-r"><span>${MODELS.find((m) => m.key === k)?.label}</span><b>${inch(v)}</b></div>`).join('');
    tip.innerHTML = `<div class="tt-h">${dayDate(d.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <div class="tt-r"><span><i class="sw" style="background:var(--summit)"></i>Summit</span><b>${inch(d.snow)}</b></div>
      <div class="tt-r"><span><i class="sw" style="background:var(--base)"></i>Base</span><b>${inch(b?.snow)}</b></div>
      ${modelRows ? `<div style="border-top:1px solid var(--border);margin:5px 0"></div>${modelRows}` : ''}
      <div class="tt-r"><span>Snow level</span><b>${ft(d.snowLevelFt)}</b></div>
      <div class="tt-r"><span>Summit hi/lo</span><b>${deg(d.hiF)}/${deg(d.loF)}F</b></div>`;
    tip.hidden = false;
  };
  el.querySelectorAll('.hit').forEach((h) => {
    h.addEventListener('mouseenter', () => show(h));
    h.addEventListener('click', (e) => { e.stopPropagation(); show(h); });
  });
}

function hideTips() {
  document.querySelectorAll('.chart-wrap .tooltip').forEach((t) => { t.hidden = true; });
  document.querySelectorAll('.hit.active').forEach((h) => h.classList.remove('active'));
}
document.addEventListener('click', hideTips);

// ---------- trail map + food ----------
let leafletP;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletP ||= new Promise((resolve, reject) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/vendor/leaflet/leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js'; s.onload = resolve; s.onerror = () => reject(new Error('map library failed to load'));
    document.head.appendChild(s);
  });
  return leafletP;
}

const trailMapLink = (r) => r.trailMapUrl || `https://www.google.com/search?q=${encodeURIComponent(`${r.name} ${r.state || ''} trail map`)}`;
const KIND_ICON = { restaurant: '🍽️', cafe: '☕', bar: '🍺', pub: '🍺', fast_food: '🍔' };
const KIND_LABEL = { restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Pub', fast_food: 'Quick bite' };
const miles = (k) => (k < 0.2 ? `${Math.round(k * 3281)} ft` : `${(k * 0.621371).toFixed(k < 16 ? 1 : 0)} mi`);
const foodCache = new Map();

const FOOD_KEY = (r) => `wp:food:v3:${r.lat.toFixed(3)},${r.lon.toFixed(3)}`;
async function getFood(r) {
  const c = foodCache.get(r.id);
  if (c) return c;
  const p = (async () => {
    try { // saved on this phone for a week
      const saved = JSON.parse(localStorage.getItem(FOOD_KEY(r)) || 'null');
      if (saved && Date.now() - saved.at < 7 * 864e5) return saved.data;
    } catch {}
    let data;
    try { data = await getJSON(`/api/food?lat=${r.lat}&lon=${r.lon}`); } // server: Nominatim + Overpass, cached a day
    catch (e1) {
      try { data = buildFood(await fetchOverpass(foodQuery(r.lat, r.lon)), r.lat, r.lon); } // phone straight to OpenStreetMap
      catch (e2) { return { error: `server ${e1.message}; direct ${e2.message}`, slopeside: [], town: [] }; }
    }
    const found = (data.slopeside?.length || 0) + (data.town?.length || 0);
    if (!data.error && found) try { localStorage.setItem(FOOD_KEY(r), JSON.stringify({ at: Date.now(), data })); } catch {}
    return data;
  })();
  foodCache.set(r.id, p);
  const v = await p;
  if (v.error) foodCache.delete(r.id);
  return v;
}

async function mountMap(el, r, { withFood = true } = {}) {
  try { await loadLeaflet(); } catch (e) { el.innerHTML = `<p class="pad small err">${esc(e.message)}</p>`; return; }
  if (!el.isConnected) return;
  const L = window.L;
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: false, tap: true }).setView([r.lat, r.lon], 14);
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, subdomains: 'abc',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  }).addTo(map);
  const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const pistes = L.tileLayer('https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: 'Runs & lifts © <a href="https://www.opensnowmap.org">OpenSnowMap</a> (CC-BY-SA)',
  }).addTo(map);
  const overlays = { 'Ski runs & lifts': pistes };
  if (withFood) {
    const foodLayer = L.layerGroup().addTo(map);
    overlays['Food & drink'] = foodLayer;
    getFood(r).then((f) => {
      [...(f.slopeside || []).map((p) => [p, true]), ...(f.town || []).slice(0, 25).map((p) => [p, false])].forEach(([p, slope]) => {
        L.circleMarker([p.lat, p.lon], { radius: 7, weight: 2, color: '#fff', fillColor: slope ? '#d95926' : '#8f8e86', fillOpacity: 1 })
          .bindPopup(`<b>${esc(p.name)}</b><br>${esc(KIND_LABEL[p.kind] || '')}${p.cuisine ? ` · ${esc(p.cuisine)}` : ''}<br>${slope ? 'Slopeside' : miles(p.distKm) + ' away'}`)
          .addTo(foodLayer);
      });
    });
  }
  L.control.layers({ Terrain: topo, Streets: streets }, overlays, { collapsed: true }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

function foodList(list, limit, id) {
  if (!list.length) return '<p class="small muted">None mapped.</p>';
  const item = (p) => `<div class="fitem">
      <div class="fico">${KIND_ICON[p.kind] || '🍽️'}</div>
      <div class="fbody"><b>${esc(p.name)}</b>
        <span class="small muted">${esc(KIND_LABEL[p.kind] || p.kind)}${p.cuisine ? ` · ${esc(p.cuisine)}` : ''} · ${miles(p.distKm)}</span>
        ${p.hours ? `<span class="small muted">${esc(p.hours)}</span>` : ''}
      </div>
      <div class="facts">
        <a class="btn sm" href="https://maps.apple.com/?daddr=${p.lat},${p.lon}&q=${encodeURIComponent(p.name)}" target="_blank" rel="noopener">Go</a>
        ${p.website ? `<a class="btn sm" href="${esc(/^https?:/.test(p.website) ? p.website : `https://${p.website}`)}" target="_blank" rel="noopener">Site</a>` : ''}
      </div>
    </div>`;
  const more = list.length > limit ? `<details class="fmore"><summary>Show ${list.length - limit} more</summary>${list.slice(limit).map(item).join('')}</details>` : '';
  return `<div id="${id}">${list.slice(0, limit).map(item).join('')}${more}</div>`;
}

async function loadFoodSection(r) {
  const el = () => document.getElementById('food');
  const f = await getFood(r);
  if (!el() || location.hash !== `#/resort/${r.id}`) return;
  if (f.error) {
    el().innerHTML = `<p class="small muted">Couldn't load places right now (${esc(f.error)}).</p><button class="btn sm" id="food-retry">Try again</button>`;
    document.getElementById('food-retry').onclick = () => { el().innerHTML = '<p class="small muted">Loading…</p>'; loadFoodSection(r); };
    return;
  }
  el().innerHTML = `
    <h4 class="fh">⛷️ Slopeside &amp; on-mountain</h4>
    ${foodList(f.slopeside || [], 8, 'f-slope')}
    <h4 class="fh">🏘️ Nearby town</h4>
    ${foodList(f.town || [], 10, 'f-town')}
    <p class="small muted" style="margin-top:10px">From <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors. Slopeside means inside the mapped ski area or within about 600 m of the base. Hours and listings can be out of date.</p>`;
}

// Trail maps: official images (Skimap.org) + interactive OpenSkiMap.
const tmCache = new Map();
function getTrailMaps(r) {
  if (!tmCache.has(r.id)) {
    tmCache.set(r.id, getJSON(`/api/trailmap?lat=${r.lat}&lon=${r.lon}&name=${encodeURIComponent(r.name)}`)
      .catch((e) => { tmCache.delete(r.id); return { error: e.message, maps: [] }; }));
  }
  return tmCache.get(r.id);
}
const openSkiMapUrl = (r, area, zoom = 14) => `https://openskimap.org/${area?.openskimapId ? `?obj=${encodeURIComponent(area.openskimapId)}` : ''}#${zoom}/${r.lat}/${r.lon}`;

async function loadTrailMaps(r) {
  const t = await getTrailMaps(r);
  if (location.hash !== `#/resort/${r.id}`) return;
  const tm = document.getElementById('tmaps'), sm = document.getElementById('skimap');
  if (sm) sm.innerHTML = `<iframe src="${esc(openSkiMapUrl(r, t.area))}" title="${esc(r.name)} ski map" loading="lazy" allow="fullscreen"></iframe>`;
  if (!tm) return;
  const maps = (t.maps || []).filter((m) => m.thumb || m.image);
  tm.innerHTML = maps.length
    ? `<div class="tm-row">${maps.map((m, i) => `<a class="tm" href="#/resort/${r.id}/trailmap/${i}"><img src="${esc(m.thumb || m.image)}" alt="${esc(r.name)} trail map${m.year ? ` ${m.year}` : ''}" loading="lazy"/><span>${m.year ? `${m.year} map` : 'Trail map'}</span></a>`).join('')}</div>
       <p class="small muted" style="margin:6px 12px 0">Published resort maps via <a href="${esc(t.area?.skimapUrl || 'https://skimap.org')}" target="_blank" rel="noopener">Skimap.org</a>. Tap to zoom.</p>`
    : `<div class="tm-none"><p class="small muted">No published map found in the Skimap.org archive${t.error ? ' right now' : ''}.</p><a class="btn sm" href="${esc(trailMapLink(r))}" target="_blank" rel="noopener">${r.trailMapUrl ? `${esc(r.name)} official trail map ↗` : 'Find the official trail map ↗'}</a></div>`;
}

async function renderTrailMapImage(r, idx) {
  app.innerHTML = `<div class="dhead"><a class="circ" href="#/resort/${r.id}" aria-label="Back">‹</a><div class="dh-title">${esc(r.name)}</div><span style="width:46px"></span></div><div id="tmv"><p class="muted pad">Loading map…</p></div>`;
  const t = await getTrailMaps(r);
  const maps = (t.maps || []).filter((m) => m.image || m.thumb);
  const m = maps[Number(idx) || 0];
  const el = document.getElementById('tmv');
  if (!el) return;
  if (!m) { el.innerHTML = `<p class="pad muted">Map not available.</p>`; return; }
  const src = m.image || m.thumb;
  el.innerHTML = `
    ${maps.length > 1 ? `<div class="chiprow">${maps.map((x, i) => `<a class="dchip ${i === Number(idx || 0) ? 'on' : ''}" href="#/resort/${r.id}/trailmap/${i}" style="width:auto;padding:6px 12px"><b style="font-size:14px">${x.year || `Map ${i + 1}`}</b></a>`).join('')}</div>` : ''}
    <div class="tmv-wrap"><img id="tmv-img" src="${esc(src)}" alt="${esc(r.name)} trail map" /></div>
    <div class="ddlinks" style="padding:10px 0">
      <button class="btn sm" id="tmv-zoom">Zoom 2×</button>
      <a class="btn sm" href="${esc(src)}" target="_blank" rel="noopener">Open full size ↗</a>
      ${m.pdf ? `<a class="btn sm" href="${esc(m.pdf)}" target="_blank" rel="noopener">PDF ↗</a>` : ''}
    </div>
    <p class="small muted">Pinch to zoom, drag to pan. Map${m.year ? ` (${m.year})` : ''} via <a href="${esc(m.page || t.area?.skimapUrl || 'https://skimap.org')}" target="_blank" rel="noopener">Skimap.org</a>; © the resort.</p>`;
  let z = 1;
  document.getElementById('tmv-zoom').onclick = (e) => {
    z = z === 1 ? 2 : z === 2 ? 3 : 1;
    document.getElementById('tmv-img').style.width = `${z * 100}%`;
    e.target.textContent = z === 3 ? 'Fit' : `Zoom ${z + 1}×`;
  };
}

async function renderMapFull(r) {
  app.innerHTML = `<div class="dhead"><a class="circ" href="#/resort/${r.id}" aria-label="Back">‹</a><div class="dh-title">${esc(r.name)} ski map</div><span style="width:46px"></span></div>
    <div id="fullmap" class="fullmap"><p class="muted pad">Loading…</p></div>
    <p class="small muted" style="margin:8px 4px">Interactive map by <a href="https://openskimap.org" target="_blank" rel="noopener">OpenSkiMap.org</a> (OpenStreetMap data). Tap a run or lift for details.</p>`;
  const t = await getTrailMaps(r);
  const el = document.getElementById('fullmap');
  if (el) el.innerHTML = `<iframe src="${esc(openSkiMapUrl(r, t.area, 14))}" title="${esc(r.name)} ski map" allow="fullscreen"></iframe>`;
}

function mapLegend() {
  return `<div class="key maplegend"><span><i style="background:#2ea043"></i>Easy</span><span><i style="background:#2f6fd6"></i>Intermediate</span><span><i style="background:#111;border:1px solid #888"></i>Advanced</span><span><i style="background:#e5a50a"></i>Freeride</span><span><i style="background:#d95926;border-radius:50%"></i>Slopeside food</span></div>`;
}

// ---------- detailed daily (Day/Night) + hourly ----------
const detailCache = new Map();
async function getDetail(r) {
  const c = detailCache.get(r.id);
  if (c && Date.now() - c.at < FRESH_MS && c.summitFt === r.summitFt) return c.data;
  const data = await fetchDetail(r);
  detailCache.set(r.id, { at: Date.now(), data, summitFt: r.summitFt });
  return data;
}

const TYPE_LABEL = { snow: 'Snow', mix: 'Snow/Rain', rain: 'Rain', none: 'None' };
const pct = (v) => (v == null ? '–' : `${Math.round(v)}%`);
const in2 = (v) => (v == null ? '–' : v.toFixed(2));
const snowRange = (p) => (p.snowIn < 0.5 ? inch(p.snowIn) : p.snowMax - p.snowMin >= 1 ? `${Math.max(0, Math.floor(p.snowMin))}-${Math.ceil(p.snowMax)}"` : inch(p.snowIn));
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;

function subHeader(r, title, back) {
  return `<div class="dhead"><a class="circ" href="${back}" aria-label="Back">‹</a><div class="dh-title">${esc(r.name)}</div><span style="width:46px"></span></div>
    <h2 class="dd-h">${title}</h2>
    <div class="fp" style="margin:0 4px 10px">Forecast Point <b>${r.summitFt.toLocaleString()} ft</b> <span class="muted">· blend of GFS, ECMWF, GEM</span></div>`;
}

async function renderDaily(r) {
  app.innerHTML = subHeader(r, 'Detailed Daily Forecast', `#/resort/${r.id}`) + `<div id="dd"><p class="muted pad">Loading detailed forecast…</p></div>`;
  let d;
  try { d = await getDetail(r); } catch (e) {
    document.getElementById('dd').innerHTML = `<div class="pad"><p class="err">Couldn't load the detailed forecast.</p><p class="small muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  if (location.hash !== `#/resort/${r.id}/daily`) return;
  const P = d.periods;
  const maxSnow = Math.max(6, ...P.map((p) => p.snowMax));
  const groups = [];
  P.forEach((p) => { const g = groups[groups.length - 1]; if (g && g.date === p.date) g.n++; else groups.push({ date: p.date, n: 1 }); });
  const row = (label, unit, f, cls = '') => `<tr class="${cls}"><th class="rl">${label} <span class="muted">${unit}</span></th>${P.map((p) => `<td class="${p.type !== 'none' && p.snowIn >= 0.1 ? 'hl' : ''}">${f(p)}</td>`).join('')}</tr>`;
  const snowCell = (p) => {
    const h = p.snowIn >= 0.1 ? Math.max(5, Math.round((p.snowMax / maxSnow) * 70)) : 0;
    const hMid = p.snowIn >= 0.1 ? Math.max(4, Math.round((p.snowIn / maxSnow) * 70)) : 0;
    return `<div class="dd-bar"><div class="dd-v ${p.snowIn >= 0.5 ? 'hlv' : ''}">${snowRange(p)}</div>${h ? `<div class="bar t-${p.type}" style="height:${hMid}px"></div>` : `<div class="bar zero t-${p.type}"></div>`}</div>`;
  };
  document.getElementById('dd').innerHTML = `
    <div class="card flat dd-card"><div class="dd-scroll"><table class="dd">
      <thead>
        <tr><th class="rl"></th>${groups.map((g) => `<th colspan="${g.n}" class="dd-date"><a href="#/resort/${r.id}/hourly/${g.date}">${dow(g.date)} <b>${dom(g.date)}</b> ›</a></th>`).join('')}</tr>
        <tr><th class="rl"></th>${P.map((p) => `<th class="dd-part">${p.part}</th>`).join('')}</tr>
      </thead>
      <tbody>
        <tr class="snowrow"><th class="rl">Snowfall <span class="muted">in</span></th>${P.map((p) => `<td>${snowCell(p)}</td>`).join('')}</tr>
        ${row('Snow Ratio', 'SLR', (p) => (p.slr ? `${p.slr}:1` : '--'), 'sep')}
        ${row('Snow Level', 'ft', (p) => (p.snowLevelFt == null ? '–' : (Math.round(p.snowLevelFt / 100) * 100).toLocaleString()))}
        ${row('Precip Chance', '%', (p) => pct(p.pop))}
        ${row('Precipitation', 'in', (p) => in2(p.liquidIn))}
        ${row('Weather', '', (p) => `<span class="wx" title="${TYPE_LABEL[p.type]}">${p.icon}</span>`, 'sep')}
        ${row('Temperature', '°F', (p) => (p.tempF == null ? '–' : Math.round(p.tempF)))}
        ${row('Feels Like', '°F', (p) => (p.feelsF == null ? '–' : Math.round(p.feelsF)))}
        ${row('Rel. Humidity', '%', (p) => (p.rh == null ? '–' : Math.round(p.rh)))}
        ${row('Wind Speed', 'mph', (p) => `${compass(p.dir)}${p.windMph == null ? '–' : Math.round(p.windMph)}`, 'sep')}
        ${row('Wind Gust', 'mph', (p) => (p.gustMph == null ? '–' : Math.round(p.gustMph)))}
        ${row('Cloud Cover', '%', (p) => (p.cloud == null ? '–' : Math.round(p.cloud)), 'sep')}
      </tbody>
    </table></div>
    ${typeLegend()}
    </div>
    <p class="small muted" style="margin:10px 4px">Day = 6a–6p (temperature is the high), Night = 6p–6a (temperature is the low). Snowfall shows the model range when the models disagree by an inch or more. ${P.some((p) => p.popSource === 'agreement') ? 'Precip chance is the share of models producing at least 0.01" when a model probability isn\'t available.' : ''} Tap a date for its hourly forecast.</p>`;
}

function typeLegend() {
  return `<div class="ptype"><b>Precipitation Type</b><div class="key" style="justify-content:flex-start;margin:6px 0 0">
    <span><i class="t-snow"></i>Snow</span><span><i class="t-mix"></i>Snow/Rain</span><span><i class="t-rain"></i>Rain</span><span><i class="t-none"></i>None</span></div></div>`;
}

async function renderHourly(r, date) {
  app.innerHTML = subHeader(r, 'Hourly Forecast', `#/resort/${r.id}`) + `<div id="hh"><p class="muted pad">Loading hourly forecast…</p></div>`;
  let d;
  try { d = await getDetail(r); } catch (e) {
    document.getElementById('hh').innerHTML = `<div class="pad"><p class="err">Couldn't load the hourly forecast.</p><p class="small muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  if (!location.hash.startsWith(`#/resort/${r.id}/hourly`)) return;
  const sel = d.dates.includes(date) ? date : d.dates[0];
  const H = d.hours.filter((x) => x.date === sel);
  const maxSnow = Math.max(1, ...H.map((x) => x.snowIn));
  const tot = H.reduce((a, x) => a + x.snowIn, 0), liq = H.reduce((a, x) => a + x.liquidIn, 0);
  document.getElementById('hh').innerHTML = `
    <div class="chiprow" id="chips">${d.dates.map((dt) => `<a class="dchip ${dt === sel ? 'on' : ''}" href="#/resort/${r.id}/hourly/${dt}"><span>${dow(dt)}</span><b>${dom(dt)}</b></a>`).join('')}</div>
    <div class="hh-sum">${dayDate(sel).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} · snow <b>${inch(tot)}</b> · precip <b>${in2(liq)}"</b> </div><div class="hh-sum" style="margin-top:-4px"><a href="#/resort/${r.id}/daily">Day/Night view ›</a></div>
    <div class="card flat"><div class="dd-scroll"><table class="hh">
      <thead><tr><th class="rl">Time</th><th></th><th>Temp</th><th>Feels</th><th>Snow</th><th>Precip</th><th>Wind</th><th>Gust</th><th>Cloud</th><th>Snow lvl</th></tr></thead>
      <tbody>${H.map((x) => `<tr class="${x.snowIn >= 0.1 ? 'hl' : ''}">
        <th class="rl">${hourLabel(x.hour)}</th>
        <td class="wx">${x.icon}</td>
        <td><b>${x.tempF == null ? '–' : Math.round(x.tempF)}°</b></td>
        <td>${x.feelsF == null ? '–' : Math.round(x.feelsF)}°</td>
        <td class="hsnow"><span class="hbar t-${x.snowIn >= 0.05 ? x.type : 'none'}" style="width:${x.snowIn >= 0.05 ? Math.max(4, Math.round((x.snowIn / maxSnow) * 34)) : 0}px"></span>${x.snowIn >= 0.05 ? x.snowIn.toFixed(1) + '"' : '0"'}</td>
        <td><i class="dot t-${x.type}"></i>${in2(x.liquidIn)}</td>
        <td>${compass(x.dir)} ${x.windMph == null ? '–' : Math.round(x.windMph)}</td>
        <td>${x.gustMph == null ? '–' : Math.round(x.gustMph)}</td>
        <td>${x.cloud == null ? '–' : Math.round(x.cloud) + '%'}</td>
        <td>${x.snowLevelFt == null ? '–' : (Math.round(x.snowLevelFt / 100) * 100).toLocaleString() + "'"}</td>
      </tr>`).join('')}</tbody>
    </table></div>${typeLegend()}</div>`;
  document.querySelector('#chips .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------- manage mountains ----------
let searchSeq = 0;
// ---------- drag to reorder (touch + mouse) ----------
// The order of the given ids is applied to RESORTS; mountains not in the list keep their slots.
function applyOrder(ids) {
  const set = new Set(ids);
  const slots = RESORTS.map((r, i) => (set.has(r.id) ? i : -1)).filter((i) => i >= 0);
  const moved = ids.map((id) => RESORTS.find((r) => r.id === id)).filter(Boolean);
  slots.forEach((slot, k) => { RESORTS[slot] = moved[k]; });
  saveMountains(RESORTS);
}

let sortActive = false;
// Press-and-hold (or grab a handle) to drag. The dragged item follows the finger; the others slide
// out of the way with a transition; on release it glides into its slot and only then is the DOM reordered.
function sortable(list, itemSel, { handle, longPress = 0, onDrop }) {
  if (!list || list.dataset.sortable) return;
  list.dataset.sortable = '1';
  let item = null, timer = null, startX = 0, startY = 0, lastY = 0, raf = 0;
  let snap = null; // { els, tops, bottoms, idx0, target, startPageY, dh }
  const items = () => [...list.querySelectorAll(itemSel)];
  document.addEventListener('touchmove', (e) => { if (sortActive) e.preventDefault(); }, { passive: false });
  const EASE = 'transform .22s cubic-bezier(.2,.8,.2,1)';

  const begin = () => {
    sortActive = true;
    const els = items();
    const rects = els.map((el) => el.getBoundingClientRect());
    const idx0 = els.indexOf(item);
    const next = rects[idx0 + 1] || null, prev = rects[idx0 - 1] || null;
    const gap = next ? next.top - rects[idx0].bottom : prev ? rects[idx0].top - prev.bottom : 8;
    snap = { els, tops: rects.map((r) => r.top + scrollY), bottoms: rects.map((r) => r.bottom + scrollY), idx0, target: idx0, startPageY: lastY + scrollY, dh: rects[idx0].height + gap };
    els.forEach((el) => { if (el !== item) el.style.transition = EASE; });
    item.style.transition = 'box-shadow .15s';
    item.classList.add('dragging'); list.classList.add('sorting');
    haptic(12);
    const loop = () => {
      if (!sortActive) return;
      const edge = 80;
      if (lastY < edge) window.scrollBy(0, -Math.ceil((edge - lastY) / 8));
      else if (lastY > innerHeight - edge) window.scrollBy(0, Math.ceil((lastY - innerHeight + edge) / 8));
      place();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };
  const place = () => {
    if (!snap) return;
    const { els, tops, bottoms, idx0, dh } = snap;
    const dy = lastY + scrollY - snap.startPageY;
    item.style.transform = `translateY(${dy}px) scale(1.02)`;
    const center = (tops[idx0] + bottoms[idx0]) / 2 + dy;
    let target = 0;
    els.forEach((el, i) => { if (i !== idx0 && (tops[i] + bottoms[i]) / 2 < center) target++; });
    if (snap.target !== target) haptic(6); // tick each time a card moves out of the way
    snap.target = target;
    els.forEach((el, i) => {
      if (i === idx0) return;
      const shift = i > idx0 && i <= target ? -dh : i < idx0 && i >= target ? dh : 0;
      const t = shift ? `translateY(${shift}px)` : '';
      if (el.style.transform !== t) el.style.transform = t;
    });
  };
  const finish = () => {
    const { els, tops, bottoms, idx0, target } = snap;
    haptic(10);
    const finalTop = target > idx0 ? bottoms[target] - (bottoms[idx0] - tops[idx0]) : target < idx0 ? tops[target] : tops[idx0];
    item.style.transition = EASE;
    item.style.transform = `translateY(${finalTop - tops[idx0]}px)`;
    const el = item;
    setTimeout(() => {
      // commit the new order, then drop all transforms without animating
      const order = els.filter((x) => x !== el);
      order.splice(target, 0, el);
      els.forEach((x) => { x.style.transition = 'none'; x.style.transform = ''; });
      // re-insert in the new order right where the block was
      const marker = document.createComment('s');
      list.insertBefore(marker, els[0]);
      order.forEach((x) => list.insertBefore(x, marker));
      marker.remove();
      void list.offsetHeight;
      els.forEach((x) => { x.style.transition = ''; });
      el.classList.remove('dragging'); list.classList.remove('sorting');
      sortActive = false;
      if (target !== idx0) onDrop(order.map((x) => x.dataset.id));
    }, 230);
  };
  const end = () => {
    clearTimeout(timer); timer = null;
    if (!item) return;
    cancelAnimationFrame(raf);
    const was = sortActive && snap;
    if (was) {
      const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
      document.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', stop, true), 450);
      finish();
    }
    item = null; snap = was ? snap : null;
  };
  list.addEventListener('pointerdown', (e) => {
    if (sortActive) return;
    const it = e.target.closest(itemSel);
    if (!it || !list.contains(it) || (handle && !e.target.closest(handle))) return;
    item = it; startX = e.clientX; startY = lastY = e.clientY;
    if (longPress) timer = setTimeout(() => { timer = null; begin(); }, longPress);
    else { e.preventDefault(); begin(); }
  });
  window.addEventListener('pointermove', (e) => {
    if (!item) return;
    if (timer) { if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) { clearTimeout(timer); timer = null; item = null; } return; }
    lastY = e.clientY;
  });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', () => { if (!sortActive) { clearTimeout(timer); timer = null; item = null; } else end(); });
  list.addEventListener('contextmenu', (e) => { if (sortActive || timer) e.preventDefault(); });
  list.addEventListener('dragstart', (e) => { if (e.target.closest?.(itemSel) || e.target.parentElement?.closest(itemSel)) e.preventDefault(); });
}

function renderManage() {
  const inList = (c) => RESORTS.some((r) => Math.abs(r.lat - c.lat) < 0.02 && Math.abs(r.lon - c.lon) < 0.02);
  app.innerHTML = `
    <div class="mhead"><a class="back" href="#/">‹ Done</a><h1 class="title">My mountains</h1></div>
    <section class="section">
      <h3>Your list · ★ = favorite · drag ☰ to reorder</h3>
      <div id="mylist">${RESORTS.length ? RESORTS.map((r, i) => `
        <div class="mrow" data-id="${r.id}">
          <span class="grip" aria-label="Drag to reorder" title="Drag to reorder">☰</span>
          <button class="star ${FAVS.has(r.id) ? 'on' : ''}" data-act="fav" aria-label="Favorite">${FAVS.has(r.id) ? '★' : '☆'}</button>
          <div class="mname"><b>${esc(r.name)}</b><span class="small muted">${esc([r.state, r.country].filter(Boolean).join(', '))}</span><span class="small muted">${r.baseFt.toLocaleString()}–${r.summitFt.toLocaleString()} ft${r.snotel ? ' · SNOTEL' : ''}</span></div>
          <button class="ib" data-act="edit" aria-label="Edit elevations">✎</button>
          <button class="ib del" data-act="del" aria-label="Delete">🗑</button>
        </div>`).join('') : '<p class="small muted">No mountains yet — add some below.</p>'}</div>
    </section>
    <section class="section">
      <h3>Add a mountain</h3>
      <button class="btn block" id="near-zip" style="margin:0 0 10px">📍 Add mountains near a ZIP code</button>
      <input id="q" class="search" type="search" placeholder="Search resorts or towns worldwide…" autocomplete="off" />
      <div id="results"></div>
      <p class="small muted" style="margin-top:10px">Base and summit elevations are measured from terrain data when you add a mountain — tap ✎ to fine-tune them.</p>
    </section>
    <p style="text-align:center"><button class="btn" id="reset">Reset to the original 5</button></p>`;

  const results = document.getElementById('results');
  const row = (c, src) => `<div class="mrow">
      <div class="mname"><b>${esc(c.name)}</b><span class="small muted">${esc([c.state, c.country].filter(Boolean).join(', '))}${src === 'geo' ? ' · place search' : ''}</span></div>
      ${inList(c) ? '<span class="small muted">Added</span>' : `<button class="btn sm primary" data-add='${esc(JSON.stringify(c))}'>+ Add</button>`}
    </div>`;
  const showCatalog = (q) => {
    const t = q.trim().toLowerCase();
    const cat = CATALOG.filter((c) => !t || `${c.name} ${c.state} ${c.country}`.toLowerCase().includes(t));
    return (t ? '' : '<div class="small muted" style="margin:10px 0 4px">Popular mountains</div>') + cat.map((c) => row(c, 'cat')).join('');
  };
  results.innerHTML = showCatalog('');

  const q = document.getElementById('q');
  let timer;
  q.addEventListener('input', () => {
    const v = q.value;
    results.innerHTML = showCatalog(v);
    clearTimeout(timer);
    if (v.trim().length < 3) return;
    const seq = ++searchSeq;
    timer = setTimeout(async () => {
      const places = await searchPlaces(v.trim()).catch(() => []);
      if (seq !== searchSeq) return;
      const extra = places.filter((p) => !CATALOG.some((c) => Math.abs(c.lat - p.lat) < 0.05 && Math.abs(c.lon - p.lon) < 0.05));
      const catHtml = showCatalog(v);
      results.innerHTML = (catHtml || '') + (extra.length ? `<div class="small muted" style="margin:12px 0 4px">Places matching “${esc(v)}”</div>${extra.map((p) => row(p, 'geo')).join('')}` : (!catHtml ? '<p class="small muted">No matches.</p>' : ''));
    }, 350);
  });

  results.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    b.disabled = true; b.textContent = 'Adding…';
    const c = JSON.parse(b.dataset.add);
    let elev;
    try { elev = await measureElevations(c.lat, c.lon); } catch { elev = { baseFt: 5000, summitFt: 7000, guessed: true }; }
    const snotel = c.country === 'USA' ? await nearestSnotel(c.lat, c.lon) : null;
    const r = {
      id: uniqueId(c.name, RESORTS), name: c.name, state: c.state || '', country: c.country || '',
      region: [c.state, c.country].filter(Boolean).join(', '),
      lat: c.lat, lon: c.lon, baseFt: elev.baseFt, summitFt: elev.summitFt,
      snotel, camsUrl: null, site: c.site || null, opening: c.opening || null, openingEst: !!c.openingEst, custom: true,
    };
    RESORTS.push(r); saveMountains(RESORTS);
    FAVS.add(r.id); saveFavorites(FAVS);
    { const p = getPrefs(); if (!p.resorts.includes(r.id)) { p.resorts.push(r.id); setPrefs(p); } syncSub(); }
    renderManage();
    if (elev.guessed) alert(`Couldn't measure elevations for ${r.name} — tap ✎ to set base and summit.`);
    loadOne(r);
  });

  document.getElementById('mylist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    const i = RESORTS.findIndex((r) => r.id === id);
    const r = RESORTS[i];
    const act = b.dataset.act;
    if (act === 'fav') toggleFav(id);
    if (act === 'up' && i > 0) [RESORTS[i - 1], RESORTS[i]] = [RESORTS[i], RESORTS[i - 1]];
    if (act === 'down' && i < RESORTS.length - 1) [RESORTS[i + 1], RESORTS[i]] = [RESORTS[i], RESORTS[i + 1]];
    if (act === 'del') {
      if (!confirm(`Remove ${r.name}?`)) return;
      RESORTS.splice(i, 1); FAVS.delete(id); saveFavorites(FAVS);
      const p = getPrefs(); p.resorts = p.resorts.filter((x) => x !== id); setPrefs(p); syncSub();
    }
    if (act === 'edit') {
      const base = prompt(`${r.name} — base elevation (ft)`, r.baseFt);
      if (base === null) return;
      const top = prompt(`${r.name} — summit elevation (ft)`, r.summitFt);
      if (top === null) return;
      const bf = Math.round(Number(base)), sf = Math.round(Number(top));
      if (!(bf > -1000 && sf > bf && sf < 30000)) { alert('Summit must be higher than base.'); return; }
      r.baseFt = bf; r.summitFt = sf;
      if (state.data) delete state.data[r.id];
      loadOne(r);
    }
    saveMountains(RESORTS);
    renderManage();
  });

  sortable(document.getElementById('mylist'), '.mrow[data-id]', { handle: '.grip', onDrop: applyOrder });
  document.getElementById('near-zip').addEventListener('click', () => startOnboarding({ zipStep: true, addMode: true }));
  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Replace your list with the original 5 mountains?')) return;
    localStorage.removeItem('wp:mountains:v1'); localStorage.removeItem('wp:favorites:v1');
    RESORTS = getMountains(); FAVS = getFavorites();
    renderManage(); refresh(true);
  });
}

// ---------- first launch: ZIP → nearby mountains, then a quick tutorial ----------
const ONBOARD_KEY = 'wp:onboarded:v1';
const kmBetween = (a, b, c, d) => {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((c - a) * t) / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(((d - b) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/** Same-state mountains first (closest first), topped up with the nearest others within ~700 km. Max 6. */
function pickNearby(lat, lon, stateName) {
  const pool = [
    ...DEFAULT_RESORTS,
    ...CATALOG.filter((c) => !DEFAULT_RESORTS.some((d) => d.name.toLowerCase() === c.name.toLowerCase())),
  ].map((c) => ({ c, d: kmBetween(lat, lon, c.lat, c.lon) })).sort((a, b) => a.d - b.d);
  const st = String(stateName || '').toLowerCase();
  const picks = pool.filter((x) => st && String(x.c.state || '').toLowerCase() === st).slice(0, 6);
  for (const x of pool) { if (picks.length >= 5) break; if (!picks.includes(x) && x.d < 700) picks.push(x); }
  const out = picks.length ? picks : pool.slice(0, 4);
  return out.slice(0, 6).sort((a, b) => a.d - b.d);
}

/** Turn a default or catalog entry into a full mountain (catalog ones get elevations + nearest SNOTEL). */
async function buildMountain(c, list) {
  const def = DEFAULT_RESORTS.find((d) => d.id === c.id);
  if (def) return { ...def };
  let elev;
  const within = (p, ms, fb) => Promise.race([p, new Promise((res) => setTimeout(() => res(fb), ms))]);
  try { elev = await within(measureElevations(c.lat, c.lon), 12000, null); } catch { elev = null; }
  if (!elev) elev = { baseFt: 5000, summitFt: 7000 };
  const snotel = c.country === 'USA' ? await within(nearestSnotel(c.lat, c.lon), 8000, null) : null;
  return {
    id: uniqueId(c.name, list), name: c.name, state: c.state || '', country: c.country || '',
    region: [c.state, c.country].filter(Boolean).join(', '), lat: c.lat, lon: c.lon,
    baseFt: elev.baseFt, summitFt: elev.summitFt, snotel, camsUrl: null, site: c.site || null, opening: c.opening || null, openingEst: !!c.openingEst, custom: true,
  };
}

async function locate(q) {
  q = q.trim();
  if (/^\d{5}(-\d{4})?$/.test(q)) {
    const z = await getJSON(`/api/zip?zip=${encodeURIComponent(q.slice(0, 5))}`).catch(() => null);
    if (z && Number.isFinite(z.lat)) return { lat: z.lat, lon: z.lon, label: `${z.place}, ${z.stateCode}`, state: z.state };
  }
  const p = (await searchPlaces(q).catch(() => []))[0];
  return p ? { lat: p.lat, lon: p.lon, label: [p.name, p.state].filter(Boolean).join(', '), state: p.state } : null;
}

function modal(html) {
  document.querySelector('.modal.ob')?.remove();
  const el = document.createElement('div');
  el.className = 'modal ob';
  el.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(el);
  return el;
}

/** Build and save a starting list (first run), then start the tour. */
async function setupStart(entries, el, note, msg) {
  const built = [];
  for (const [k, c] of entries.entries()) {
    msg?.(`Setting up ${c.name}… (${k + 1}/${entries.length})`);
    if (built.some((r) => r.name.toLowerCase() === c.name.toLowerCase())) continue;
    built.push(await buildMountain(c, built));
  }
  RESORTS = built; saveMountains(RESORTS);
  FAVS = new Set(built.map((r) => r.id)); saveFavorites(FAVS);
  const pr = getPrefs(); pr.resorts = built.map((r) => r.id); setPrefs(pr);
  localStorage.setItem(VIEW_KEY, 'fav');
  el.remove();
  refresh(true);
  showTutorial(note);
}

/** First run, after the donation pop-up: closest mountains, or pick your own. */
function startChoice() {
  const el = modal(`
    <img src="/icons/icon-192.png" alt="" width="64" height="64" style="border-radius:14px" />
    <h2>Let's set up your mountains</h2>
    <p>Start with the resorts closest to you, or pick your favorites.</p>
    <button class="btn primary block ob-big" id="ob-near">📍 Closest to me</button>
    <button class="btn block ob-big" id="ob-pick">⭐ Pick my favorites</button>
    <button class="btn block ob-skipline" id="ob-skip">Skip — start with the West Coast five</button>`);
  el.querySelector('#ob-near').onclick = () => { el.remove(); startNearby(); };
  el.querySelector('#ob-pick').onclick = () => { el.remove(); startPicker(); };
  el.querySelector('#ob-skip').onclick = () => { el.remove(); showTutorial(); };
}

function startNearby() {
  const el = modal(`
    <h2>Mountains near you</h2>
    <p>Use your location, or type a ZIP code or town.</p>
    <button class="btn primary block" id="ob-gps">📍 Use my location</button>
    <form id="ob-form" class="ob-form">
      <input id="ob-zip" class="search" autocomplete="postal-code" placeholder="ZIP code or town" />
      <button class="btn block" id="ob-go">Find mountains</button>
    </form>
    <p id="ob-msg" class="small muted" style="min-height:18px"></p>
    <button class="btn block ob-skipline" id="ob-back">‹ Back</button>`);
  const msg = (t, err) => { const m = el.querySelector('#ob-msg'); m.textContent = t; m.className = `small ${err ? 'err' : 'muted'}`; };
  const go = async (loc) => {
    if (!loc) { msg("Couldn't find that place — try a ZIP code or town.", true); return; }
    setHome({ lat: loc.lat, lon: loc.lon, label: loc.label });
    const picks = pickNearby(loc.lat, loc.lon, loc.state);
    el.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
    await setupStart(picks.map((p) => p.c), el, `Added ${picks.length} mountains near ${loc.label}.`, msg);
  };
  el.querySelector('#ob-back').onclick = () => { el.remove(); startChoice(); };
  el.querySelector('#ob-gps').onclick = () => {
    if (!navigator.geolocation) return msg('Location isn\'t available — type a ZIP code instead.', true);
    msg('Finding you…');
    navigator.geolocation.getCurrentPosition(async (p) => {
      const lat = p.coords.latitude, lon = p.coords.longitude;
      // name the place (and state, which helps pick in-state resorts)
      let state = '', label = 'your location';
      try {
        const pr = (await (await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`)).json()).features?.[0]?.properties || {};
        state = pr.state || ''; const town = pr.city || pr.town || pr.village || pr.county;
        if (town) label = [town, ABBR[state] || state].filter(Boolean).join(', ');
      } catch {}
      go({ lat, lon, label, state });
    }, () => msg('Couldn\'t get your location — allow it in Settings or type a ZIP code.', true), { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  };
  el.querySelector('#ob-form').onsubmit = async (e) => {
    e.preventDefault();
    const q = el.querySelector('#ob-zip').value.trim(); if (!q) return;
    msg('Finding you…');
    go(await locate(q).catch(() => null));
  };
}

function startPicker() {
  const pool = [...DEFAULT_RESORTS, ...CATALOG.filter((c) => !DEFAULT_RESORTS.some((d) => d.name.toLowerCase() === c.name.toLowerCase()))];
  const chosen = new Set();
  const el = modal(`
    <h2>Pick your mountains</h2>
    <input id="pk-q" class="search" type="search" placeholder="Search resorts or states…" />
    <div id="pk-list" class="pk-list"></div>
    <p id="pk-msg" class="small muted" style="min-height:18px"></p>
    <button class="btn primary block" id="pk-done" disabled>Add 0 mountains</button>
    <button class="btn block ob-skipline" id="pk-back">‹ Back</button>`);
  const list = el.querySelector('#pk-list'), done = el.querySelector('#pk-done');
  const draw = () => {
    const q = el.querySelector('#pk-q').value.trim().toLowerCase();
    const items = pool.filter((c) => !q || `${c.name} ${c.state || ''} ${c.country || ''} ${c.region || ''}`.toLowerCase().includes(q));
    const sorted = [...items.filter((c) => chosen.has(c.name)), ...items.filter((c) => !chosen.has(c.name))];
    list.innerHTML = sorted.map((c) => `<label class="pk-item"><input type="checkbox" data-n="${esc(c.name)}" ${chosen.has(c.name) ? 'checked' : ''}/><span><b>${esc(c.name)}</b><span class="small muted"> ${esc(placeAbbr(c))}${passOf(c) ? ` · ${PASSES[passOf(c)]}` : ''}</span></span></label>`).join('') || '<p class="small muted">No matches — you can add any resort later with +.</p>';
    list.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => { cb.checked ? chosen.add(cb.dataset.n) : chosen.delete(cb.dataset.n); count(); }));
  };
  const count = () => { done.disabled = !chosen.size; done.textContent = `Add ${chosen.size} mountain${chosen.size === 1 ? '' : 's'}`; };
  el.querySelector('#pk-q').addEventListener('input', draw);
  el.querySelector('#pk-back').onclick = () => { el.remove(); startChoice(); };
  done.onclick = async () => {
    const picks = pool.filter((c) => chosen.has(c.name));
    el.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
    const msg = (t) => { el.querySelector('#pk-msg').textContent = t; };
    await setupStart(picks, el, `Added ${picks.length} of your favorite mountains.`, msg);
  };
  draw(); count();
}

function startOnboarding({ zipStep = !hasSavedMountains(), addMode = false } = {}) {
  if (!zipStep) return showTutorial();
  if (!addMode) return startChoice();
  const el = modal(`
    <img src="/icons/icon-192.png" alt="" width="64" height="64" style="border-radius:14px" />
    <h2>${addMode ? 'Mountains near you' : 'Welcome to White Powder'}</h2>
    <p>${addMode ? 'Enter a ZIP code or town and we\'ll add the closest mountains.' : 'Where do you ski from? Enter your ZIP code and we\'ll start you with mountains nearby.'}</p>
    <form id="ob-form" class="ob-form">
      <input id="ob-zip" class="search" inputmode="numeric" autocomplete="postal-code" placeholder="ZIP code (or town)" required />
      <button class="btn primary block" id="ob-go">Find my mountains</button>
    </form>
    <p id="ob-msg" class="small muted" style="min-height:18px"></p>
    <button class="btn block" id="ob-skip">${addMode ? 'Cancel' : 'Skip — start with the West Coast five'}</button>`);
  const msg = (t, err) => { const m = el.querySelector('#ob-msg'); m.textContent = t; m.className = `small ${err ? 'err' : 'muted'}`; };
  el.querySelector('#ob-skip').onclick = () => { el.remove(); if (!addMode) showTutorial(); };
  el.querySelector('#ob-form').onsubmit = async (e) => {
    e.preventDefault();
    const go = el.querySelector('#ob-go'); go.disabled = true;
    msg('Finding you…');
    const loc = await locate(el.querySelector('#ob-zip').value);
    if (loc) setHome({ lat: loc.lat, lon: loc.lon, label: loc.label });
    if (!loc) { msg("Couldn't find that ZIP code — try again or enter a town.", true); go.disabled = false; return; }
    const picks = pickNearby(loc.lat, loc.lon, loc.state);
    msg(`Near ${loc.label}: setting up ${picks.map((p) => p.c.name).join(', ')}…`);
    const base = addMode ? [...RESORTS] : [];
    const built = [];
    for (const p of picks) {
      if (base.concat(built).some((r) => r.name.toLowerCase() === p.c.name.toLowerCase())) continue;
      built.push(await buildMountain(p.c, base.concat(built)));
    }
    RESORTS = base.concat(built); saveMountains(RESORTS);
    if (!addMode) FAVS = new Set();
    built.forEach((r) => FAVS.add(r.id)); saveFavorites(FAVS);
    const pr = getPrefs(); pr.resorts = [...new Set([...(addMode ? pr.resorts : []), ...built.map((r) => r.id)])]; setPrefs(pr);
    localStorage.setItem(VIEW_KEY, 'fav');
    el.remove();
    refresh(true);
    if (addMode) { location.hash = '#/'; return; }
    showTutorial(`Added ${built.length} mountains near ${loc.label}.`);
  };
  setTimeout(() => el.querySelector('#ob-zip')?.focus(), 100);
}

const TUTORIAL = [
  ['🏔️', 'Your mountains', 'Each card shows whether the resort is open (the green circle fills as more lifts open), its base depth, and snow for the next 10 days. White bars are snow, blue is a rain/snow mix.'],
  ['👉', 'Swipe the snow bars', 'Swipe a card\'s bars to see the past 15 days of snowfall or days 11–15 of the forecast. Every card moves together.'],
  ['⛰️', 'Summit, Mid or Base', 'The toggle at the top switches every forecast to that elevation — warm storms can be rain at the base and powder up top.'],
  ['📋', 'Tap a mountain for more', 'Detailed day/night and hourly forecasts, live webcams, the trail map, slopeside and in-town food, and the snow report.'],
  ['⭐', 'Favorites & more mountains', 'Tap ☆ to favorite. Use + to add any resort in the world or remove mountains. Press and hold a card to drag it into a new order.'],
  ['⚙️', 'Settings & powder alerts', 'Tap the gear to switch light/dark mode or get a notification when a big snow day is coming. On iPhone, add White Powder to your Home Screen first (Share → Add to Home Screen).'],
];

// ---------- holiday flavor on the main page ----------
const HOL_LINE = {
  thanksgiving: 'Grateful for snow. Grab a turkey leg for your rider.', christmas: 'May your days be merry and your powder deep.', newyear: 'New year, new vertical. Party hat optional.',
  valentine: 'Roses are red, groomers are blue…', stpat: 'Luck of the Irish: may it dump this weekend.', easter: 'Hunting for eggs (and stashes of powder).', halloween: 'Spooky season. The scariest thing is a closed lift.',
  july4: 'Summer turns, stars & stripes.', groundhog: 'Shadow or not, we want six more weeks of winter.', mardigras: 'Laissez les bons temps rouler… down the hill.', aprilfools: 'Forecast: 300 inches tonight. (April Fools.)', birthday: 'Happy birthday! Birthday laps are mandatory.',
};
const HOL_FX = { thanksgiving: '🍂', christmas: '❄️', newyear: '🎉', valentine: '💘', stpat: '☘️', easter: '🥚', halloween: '🎃', july4: '🎆', groundhog: '🦫', mardigras: '🎭', aprilfools: '🤡', birthday: '🎈' };
// Falling things per holiday — a mix of shapes, colors and sizes so it never looks like one repeated sprite.
const leaf = (d, c1, c2) => `<svg viewBox="0 0 40 40" width="100%" height="100%"><defs><linearGradient id="g${c1.slice(1)}${c2.slice(1)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><path d="${d}" fill="url(#g${c1.slice(1)}${c2.slice(1)})"/><path d="M20 36 L20 10" stroke="rgba(60,20,0,.45)" stroke-width="1.2" fill="none"/></svg>`;
const MAPLE = 'M20 2 L23 11 L30 7 L28 15 L37 15 L31 21 L35 27 L25 25 L22 34 L20 38 L18 34 L15 25 L5 27 L9 21 L3 15 L12 15 L10 7 L17 11 Z';
const OAK = 'M20 3 C24 6 27 6 26 10 C30 10 31 14 28 16 C32 18 32 22 28 23 C31 26 29 30 25 29 C25 33 22 35 20 37 C18 35 15 33 15 29 C11 30 9 26 12 23 C8 22 8 18 12 16 C9 14 10 10 14 10 C13 6 16 6 20 3 Z';
const BIRCH = 'M20 2 C30 10 32 22 20 37 C8 22 10 10 20 2 Z';
const ASPEN = 'M20 4 C31 8 33 20 26 29 C23 33 21 35 20 37 C19 35 17 33 14 29 C7 20 9 8 20 4 Z';
const HOL_FALL = {
  thanksgiving: ['🍂', '🍁', leaf(MAPLE, '#ef4444', '#b91c1c'), leaf(OAK, '#d97706', '#92400e'), leaf(BIRCH, '#facc15', '#ca8a04'), leaf(MAPLE, '#f97316', '#c2410c'), leaf(ASPEN, '#eab308', '#a16207'), leaf(OAK, '#b45309', '#78350f'), '🍃', leaf(MAPLE, '#dc2626', '#f59e0b'), '🌰'],
  christmas: ['❄️', '❅', '❆', '🎄', '⭐', '🎁', '🔔', '❄️'], newyear: ['🎉', '🎊', '✨', '🥳', '⭐', '🎆'], valentine: ['💘', '💖', '💕', '🌹', '💗'],
  stpat: ['☘️', '🍀', '🌈', '🪙', '☘️'], easter: ['🥚', '🐣', '🌷', '🐰', '🌼'], halloween: ['🎃', '🦇', '👻', '🍬', '🕸️', '🍂'], july4: ['🎆', '🎇', '⭐', '✨', '🇺🇸'],
  groundhog: ['🦫', '❄️', '☀️'], mardigras: ['🎭', '⚜️', '🟣', '🟢', '🟡'], aprilfools: ['🤡', '🙃', '🎈', '🃏'], birthday: ['🎈', '🎉', '🎂', '🎁', '🎊'],
};
const holToday = () => { try { return holidaysOn(new Date(), aiMe().bday)[0] || null; } catch { return null; } };
const holKey = () => { const h = holToday(); return h ? `wp:holbanner:${h.key}:${new Date().toDateString()}` : ''; };
// Little decorations tucked around the White Powder logo: [on the mark, after the wordmark, by the tagline]
const HOL_DECOR = {
  thanksgiving: ['🍂', '🦃', '🥧'], christmas: ['🎅', '🎄', '🎁'], newyear: ['🥳', '🎆', '✨'], valentine: ['💘', '💝', '🌹'], stpat: ['☘️', '🌈', '🍀'],
  easter: ['🐰', '🐣', '🥚'], halloween: ['🎃', '👻', '🦇'], july4: ['🇺🇸', '🎆', '✨'], groundhog: ['🦫', '☀️', '🌨️'], mardigras: ['🎭', '🎺', '⚜️'],
  aprilfools: ['🤡', '🙃', '🎈'], birthday: ['🎉', '🎂', '🎈'],
};
function logoDecor() {
  const brand = document.querySelector('.topbar .brand'); if (!brand) return;
  brand.querySelectorAll('.logo-hol').forEach((e) => e.remove());
  const h = holToday(); if (!h) return;
  const [a, b, c] = HOL_DECOR[h.key] || [h.emoji, h.emoji, '✨'];
  brand.insertAdjacentHTML('beforeend', `<span class="logo-hol d1" aria-hidden="true">${a}</span><span class="logo-hol d2" aria-hidden="true">${b}</span><span class="logo-hol d3" aria-hidden="true">${c}</span>`);
  brand.title = `${h.name}!`;
}
function holidayBanner() {
  const h = holToday(); if (!h || localStorage.getItem(holKey())) return '';
  const title = h.key === 'birthday' ? `Happy birthday${aiMe().name ? `, ${esc(aiMe().name)}` : ''}!` : `${esc(h.name.replace(/^Happy /, 'Happy '))}${/!$/.test(h.name) ? '' : '!'}`;
  return `<div class="hol-banner hol-${h.key}"><span class="hol-emoji">${h.emoji}</span><div class="hol-txt"><b>${title}</b><span>${esc(HOL_LINE[h.key] || '')}</span></div>
    <button class="hol-cta" id="hol-go">Props ›</button><button class="hol-x" id="hol-x" aria-label="Hide for today">✕</button></div>`;
}
function holidayDecor() {
  const h = holToday();
  document.documentElement.dataset.holiday = h ? h.key : '';
  if (!h || sessionStorage.getItem('wp:holfx') === h.key) return;
  try { sessionStorage.setItem('wp:holfx', h.key); } catch {}
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'); box.className = 'hol-fx'; box.setAttribute('aria-hidden', 'true');
  const pool = HOL_FALL[h.key] || [h.emoji];
  const rnd = (a, b) => a + Math.random() * (b - a);
  box.innerHTML = Array.from({ length: 30 }, (_, i) => {
    const item = pool[i % pool.length], sz = rnd(16, 34);
    return `<i style="left:${rnd(-4, 100).toFixed(1)}%;animation-delay:${rnd(0, 3.2).toFixed(2)}s;animation-duration:${rnd(4.2, 7.5).toFixed(1)}s;--dx:${rnd(-60, 80).toFixed(0)}px;--sw:${rnd(18, 46).toFixed(0)}px;--spin:${rnd(220, 720).toFixed(0)}deg;font-size:${sz.toFixed(0)}px;width:${sz.toFixed(0)}px">
      <b style="animation-duration:${rnd(1.1, 2.4).toFixed(1)}s;animation-delay:-${rnd(0, 2).toFixed(1)}s">${item}</b></i>`;
  }).join('');
  document.body.appendChild(box); setTimeout(() => box.remove(), 11500);
}

function holidayPromo() {
  if (!localStorage.getItem(ONBOARD_KEY)) return; // first run has its own rider prompt
  const h = holidaysOn(new Date(), aiMe().bday)[0]; if (!h) return;
  const key = `wp:holpromo:${h.key}:${h.year}`; if (localStorage.getItem(key)) return;
  try { localStorage.setItem(key, '1'); } catch {}
  const base = normAv(myAv() || randomAvatar()), demo = { ...base, acc: [...new Set([...base.acc, ...h.props])] };
  const el = document.createElement('div'); el.className = 'hol-promo';
  el.innerHTML = `<div class="hol-promo-av">${avatarSvg(demo, { size: 74, cls: 'av-bob' })}</div><div class="hol-promo-txt"><b>${h.emoji} ${esc(h.name)}!</b>
    <span>Limited-time props: ${h.props.map((k) => esc(accLabel(k))).join(', ')}. Dress up your rider.</span>
    <div class="hol-promo-btns"><button class="btn primary sm" id="hp-go">Try them on</button><button class="btn sm" id="hp-x">Later</button></div></div>`;
  document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('in'));
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); };
  el.querySelector('#hp-x').onclick = close;
  el.querySelector('#hp-go').onclick = () => { close(); openAvatarBuilder(() => { if (location.hash.startsWith('#/ai')) renderAI(); }, 'acc'); };
}

function showTutorial(intro = '') {
  // First run only: offer the rider builder before the tour (skippable).
  if (!localStorage.getItem(ONBOARD_KEY) && !myAv() && !sessionStorage.getItem('wp:rider-asked')) {
    try { sessionStorage.setItem('wp:rider-asked', '1'); } catch {}
    const demo = randomAvatar();
    const el = modal(`<div class="rider-ask">${avatarSvg(demo, { size: 110, cls: 'av-bob' })}
      <h2>Build your rider?</h2>
      <p>Make your skier or snowboarder: helmets, goggles, outfits, as many add-ons as you like (capes and shoulder parrots included), plus your own title and signature move. Your ski squad sees it on the live map.</p>
      <button class="btn primary block ob-big" id="ra-go">Build my rider</button>
      <button class="btn block ob-skipline" id="ra-skip">Skip for now</button></div>`);
    el.querySelector('#ra-go').onclick = () => { el.remove(); openAvatarBuilder(); watchClose(); };
    el.querySelector('#ra-skip').onclick = () => { el.remove(); startTour(intro); };
    // if they close the builder without saving, still continue to the tour
    function watchClose() { const t = setInterval(() => { if (!document.querySelector('.av-modal')) { clearInterval(t); if (!document.querySelector('.tour-tip')) startTour(intro); } }, 400); }
    return;
  }
  return startTour(intro);
}
function showTutorialCards(intro = '') {
  let i = 0;
  const el = modal('<div id="tut"></div>');
  const draw = () => {
    const [icon, title, text] = TUTORIAL[i];
    el.querySelector('#tut').innerHTML = `
      ${i === 0 && intro ? `<p class="small ok">✓ ${esc(intro)}</p>` : ''}
      <div class="tut-icon">${icon}</div>
      <h2>${title}</h2>
      <p>${text}</p>
      <div class="tut-dots">${TUTORIAL.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tut-btns">
        <button class="btn" id="tut-skip">${i === TUTORIAL.length - 1 ? 'Back' : 'Skip'}</button>
        <button class="btn primary" id="tut-next">${i === TUTORIAL.length - 1 ? 'Start skiing' : 'Next'}</button>
      </div>`;
    el.querySelector('#tut-next').onclick = () => { if (i < TUTORIAL.length - 1) { i++; draw(); } else finish(); };
    el.querySelector('#tut-skip').onclick = () => { if (i === TUTORIAL.length - 1) { i--; draw(); } else finish(); };
  };
  const finish = () => {
    el.remove();
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch {}
    // (cards version unused; tour is the default)
  };
  draw();
}

// ---------- guided tour: spotlights the real app, step by step ----------
async function waitFor(sel, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const el = document.querySelector(sel);
    if (el && el.getBoundingClientRect().height > 0) return el;
    await sleep(100);
  }
  return null;
}
const tourResort = () => (shownList().list[0] || RESORTS[0])?.id;
const TOUR = [
  // Forecast tab
  { route: () => '#/', sel: '.tabbar', title: 'Three tabs', text: 'Forecast for snow at your mountains, First Tracks to plan the drive, and Powder AI for your day on the hill. This tour walks through all three.' },
  { route: () => '#/', sel: '.levelbar', title: 'Summit, Mid or Base', text: 'Switch every forecast to that elevation. Warm storms can be rain at the base and powder up top.', tryit: 'Pick one — tap Summit, Mid or Base.' },
  { route: () => '#/', sel: '.homebar .seg-ctl', title: 'Favorites, Epic or Ikon', text: 'Your favorite mountains, or every mountain on the Epic or Ikon Pass. ☆ on a pass mountain adds it to your favorites.', tryit: 'Tap Epic or Ikon, then back to Favs.' },
  { route: () => '#/', sel: '.addbtn', title: 'Add or remove mountains', text: 'Search any resort in the world, add the ones near a ZIP code, or reorder your list.' },
  { route: () => '#/', sel: '.sortpill', title: 'Sort', text: 'Order mountains by closest drive, deepest base, most new snow, or best snow per hour of driving.' },
  { route: () => '#/', sel: '.card.rc .sub', title: 'At a glance', text: 'Elevation, state, base depth — and what\'s falling right now (Light, Snow, Heavy, Mix or Blizzard).' },
  { route: () => '#/', sel: '.card.rc .mstatus', title: 'Open or closed', text: 'Live from the resort\'s lift feed. The green circle fills with the share of lifts running; closed resorts show their opening date.' },
  { route: () => '#/', sel: '.card.rc .scroller', title: 'Snow, past and future', text: 'White bars are snow, blue is a rain/snow mix. Swipe to see the past 15 days or days 11–15 — every card moves together.', tryit: 'Try it — swipe the bars sideways.' },
  { route: () => '#/', sel: '.swc', title: 'Hold, drag or swipe', text: 'Press and hold a card to drag it into a new spot. Swipe a favorite left to remove it. Pull down anywhere to refresh.' },
  // Mountain page
  { route: () => `#/resort/${tourResort()}`, sel: '#tabs', title: 'Tap any mountain', text: 'Its page has the snow summary, live cams, weather, trail map, food and the snow report. Tap a tab to jump there.' },
  { route: () => `#/resort/${tourResort()}`, sel: '.ddlinks', title: 'Day-by-day & hourly', text: 'Open the detailed Day/Night forecast or the hourly view. You can also tap any day in the bars.' },
  { route: () => `#/resort/${tourResort()}`, sel: '#status-d', title: 'Lifts & lines', text: 'See every lift\'s status — and live wait times at resorts that publish them — from "Lift lines".' },
  { route: () => `#/resort/${tourResort()}`, sel: '#sec-cams', title: 'Live webcams', text: 'Tap a cam to watch it right here. Auto-play can be turned on in Settings.' },
  { route: () => `#/resort/${tourResort()}`, sel: '#sec-map', title: 'Trail map & food', text: 'The official trail map, an interactive ski map with every run named, then slopeside and in-town food.' },
  // First Tracks
  { route: () => '#/drive', sel: '.ft-controls', title: 'First Tracks: plan the drive', text: 'Pick the mountain, your starting point, the day and first-chair time. Your vehicle (AWD, snow tires, chains) tailors the chain advice.' },
  { route: () => '#/drive', sel: '.ft-verdict, #ft-body', wait: 25000, title: 'When to leave', text: 'A leave-by time that works back from first chair, adding live traffic, chain controls and snow on the passes at the hour you\'ll cross them.' },
  { route: () => '#/drive', sel: '.ft-goals', wait: 4000, title: 'Pick your goal', text: 'First chair, secure parking, avoid the weather or beat traffic — each gives its own leave time, all compared side by side.', tryit: 'Tap Parking or Weather to compare.' },
  { route: () => '#/drive', sel: '.ft-stay', wait: 1500, title: 'Stay the night?', text: 'When the morning drive looks rough, it suggests staying near the resort, the best time to drive up the evening before, and hotel links.' },
  { route: () => '#/drive', sel: '.ft-cc, .ft-wx', wait: 4000, title: 'Roads, chains & weather', text: 'Chain controls and closures on your route with advice for your vehicle, pass reports, weather on the drive, and a pack list.' },
  { route: () => '#/drive', sel: '#ft-map', wait: 4000, title: 'Route options', text: 'Every route on one map. Tap one, then open it in Google Maps (exact route) or Apple Maps.' },
  { route: () => '#/drive', sel: '.ft-cams', wait: 4000, title: 'Highway cams', text: 'Live highway cameras along the way — tap one to enlarge.' },
  // Powder AI
  { route: () => '#/ai', sel: '.ai-start', title: 'Powder AI: your ski day', text: 'Start a day on the mountain: a 3D map tracks runs, speed and vertical, shows live lift lines, plans your next run and lift while you ride up, and shares it with your ski squad.' },
  { route: () => '#/ai', sel: '#ai-me-av', title: 'Build your rider', text: 'Make your skier or snowboarder and spin them in 3D: build (yes, weight too), helmets, goggles, outfits, unlimited add-ons, holiday props, and your own title and signature move ("Après All Day", anyone?). Your squad sees your rider on the live map.', tryit: 'Tap it to open the builder. You can also find it in Settings.' },
  { route: () => '#/ai', sel: '#ai-code, .code', title: 'Ski squad', text: 'Create a squad or join with a friend\'s 4-letter code to see each other on the map.' },
  // Settings
  { route: () => '#/', sel: '.top-actions a[href="#/settings"]', title: 'Settings', text: 'Light or dark mode, your vehicle, cam auto-play, and powder alerts when a big snow day is coming.' },
  { route: () => '#/', sel: '.brand', title: 'You\'re all set', text: 'Forecasts refresh on their own; pull down any time. Replay this tour from the bottom of the home screen.' },
];

function startTour(intro = '') {
  document.querySelector('.tour')?.remove();
  let i = 0, cur = null, alive = true;
  const ov = document.createElement('div');
  ov.className = 'tour';
  ov.innerHTML = '<div class="tour-block"></div><div class="tour-hole"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(ov);
  const hole = ov.querySelector('.tour-hole'), tip = ov.querySelector('.tour-tip'), block = ov.querySelector('.tour-block');
  // During the tour, links don't navigate (so taps on the highlighted controls can't leave the tour).
  const noNav = (e) => { const a = e.target.closest?.('a'); if (a && !tip.contains(a)) e.preventDefault(); };
  document.addEventListener('click', noNav, true);
  let curSel = null;
  const place = () => {
    if (!cur) return;
    if (!cur.isConnected && curSel) { cur = document.querySelector(curSel); if (!cur) return; } // page re-rendered
    const b = cur.getBoundingClientRect(), pad = 6;
    const L = b.left - pad, T = b.top - pad, W = b.width + pad * 2, H = b.height + pad * 2;
    Object.assign(hole.style, { top: `${T}px`, left: `${L}px`, width: `${W}px`, height: `${H}px` });
    // block taps everywhere except inside the spotlight
    block.style.clipPath = `path(evenodd, 'M0 0H${innerWidth}V${innerHeight}H0Z M${L} ${T}h${W}v${H}h-${W}Z')`;
    const below = b.bottom + 14, th = tip.offsetHeight || 170;
    const top = below + th < innerHeight - 10 ? below : Math.max(10, b.top - th - 14);
    tip.style.top = `${top}px`;
  };
  const finish = () => {
    alive = false; ov.remove(); document.removeEventListener('click', noNav, true);
    removeEventListener('resize', place); removeEventListener('scroll', place, true);
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch {}
    if (location.hash.startsWith('#/resort/')) location.hash = '#/';
  };
  const show = async () => {
    const st = TOUR[i];
    const want = st.route ? st.route() : '#/';
    const here = location.hash || '#/';
    if (want && here !== want) { location.hash = want; await sleep(350); }
    if (!document.querySelector(st.sel)) { await sleep(600); if (!document.querySelector(st.sel) && (location.hash || '#/') === want) safeRender(); }
    const el = await waitFor(st.sel, st.wait || 12000);
    if (!alive) return;
    if (!el) { if (i < TOUR.length - 1) { i++; return show(); } return finish(); }
    el.scrollIntoView({ block: 'center' });
    await sleep(200);
    cur = el; curSel = st.sel;
    tip.innerHTML = `
      ${i === 0 && intro ? `<p class="small ok">✓ ${esc(intro)}</p>` : ''}
      <div class="tour-step">${i + 1} of ${TOUR.length}</div>
      <h3>${st.title}</h3>
      <p>${st.text}</p>
      ${st.tryit ? `<p class="tryit">👆 ${st.tryit}</p>` : ''}
      <div class="tut-btns">
        <button class="btn" id="tour-skip">${i ? 'Back' : 'Skip tour'}</button>
        <button class="btn primary" id="tour-next">${i === TOUR.length - 1 ? 'Done' : 'Next'}</button>
      </div>`;
    tip.querySelector('#tour-next').onclick = () => { if (i < TOUR.length - 1) { i++; show(); } else finish(); };
    tip.querySelector('#tour-skip').onclick = () => { if (i) { i--; show(); } else finish(); };
    place();
  };
  addEventListener('resize', place); addEventListener('scroll', place, true);
  const tick = setInterval(() => (alive ? place() : clearInterval(tick)), 400);
  show();
}

// =====================================================================
// ---------- Powder AI: live ski tracking, stats, game plan, ski squad ----------
// =====================================================================
const AI_DAY_KEY = 'wp:aiday:v1', AI_HIST_KEY = 'wp:aidays:v1', AI_PREF_KEY = 'wp:aiprefs:v1', AI_ME_KEY = 'wp:aime:v1';
const AI = { tracker: null, area: null, feed: null, watch: null, wake: null, map: null, layers: null, plan: [], shownBest: null, squad: [], timers: [], lastFix: null, lastSave: 0, err: '' };
const aiPrefs = () => { try { return { level: 'blue', snow: 'any', alerts: true, ...JSON.parse(localStorage.getItem(AI_PREF_KEY) || '{}') }; } catch { return { level: 'blue', snow: 'any', alerts: true }; } };
const setAiPrefs = (p) => { try { localStorage.setItem(AI_PREF_KEY, JSON.stringify({ ...aiPrefs(), ...p })); } catch {} };
const aiMe = () => {
  let m; try { m = JSON.parse(localStorage.getItem(AI_ME_KEY) || 'null'); } catch {}
  if (!m) { m = { id: Math.random().toString(36).slice(2, 12), name: '', squad: '' }; try { localStorage.setItem(AI_ME_KEY, JSON.stringify(m)); } catch {} }
  return m;
};
const setAiMe = (p) => { try { localStorage.setItem(AI_ME_KEY, JSON.stringify({ ...aiMe(), ...p })); } catch {} };
const aiDay = () => { try { return JSON.parse(localStorage.getItem(AI_DAY_KEY) || 'null'); } catch { return null; } };
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
const DIFF_DOT = { green: '🟢', blue: '🔵', black: '⚫', expert: '◆◆' };
const aiMountains = () => {
  const seen = new Set(RESORTS.map((r) => r.name));
  return [...RESORTS.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, liftie: r.liftie || null })),
    ...CATALOG.filter((c) => !seen.has(c.name)).map((c) => ({ id: `c-${slug(c.name)}`, name: c.name, lat: c.lat, lon: c.lon, liftie: null }))];
};

function renderAI() {
  const day = aiDay();
  if (day) return renderAIDay(day);
  stopTracking();
  const p = aiPrefs(), me = aiMe();
  const hist = (() => { try { return JSON.parse(localStorage.getItem(AI_HIST_KEY) || '[]'); } catch { return []; } })();
  const mts = aiMountains();
  const seg = (name, opts, cur) => `<div class="seg-ctl ai-seg" data-pref="${name}">${Object.entries(opts).map(([k, v]) => `<button data-v="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  app.innerHTML = `
    <h1 class="title ai-title brand-title">Powder AI</h1>
    <p class="secondary ai-lede">Tracks your runs, speed and vertical, shows live lift lines, and plans your next lift while you ride up.</p>
    <section class="card pad stack">
      <label class="ai-lbl">Mountain
        <select id="ai-mtn">${mts.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>
      </label>
      <button class="linkbtn" id="ai-near">📍 Pick the mountain I'm at</button>
      <div class="ai-lbl">Terrain${seg('level', { green: 'Greens', blue: 'Blues', black: 'Blacks', expert: 'Expert' }, p.level)}</div>
      <div class="ai-lbl">Snow${seg('snow', { groomed: 'Groomed', powder: 'Powder', any: 'Either' }, p.snow)}</div>
      <label class="opt"><input type="checkbox" id="ai-alerts" ${p.alerts ? 'checked' : ''}/> Tell me if a better line opens up mid-run</label>
    </section>
    <section class="card pad stack">
      <h3 style="margin:0">Ski squad</h3>
      <div id="ai-me-av" class="ai-me-av">${myAv() ? `${riderCard(myAv(), me.name)}<button class="btn sm" id="ai-av-edit">${holidaysOn(new Date(), me.bday)[0] ? `${holidaysOn(new Date(), me.bday)[0].emoji} New props` : 'Edit rider'}</button>` : `<button class="av-cta" id="ai-av-edit">${avatarSvg(DEFAULT_AV, { size: 56, mode: 'badge' })}<span><b>Build your rider</b><span class="small muted">Pick your gear, flair and a title your friends will roast you for.</span></span><span class="chev">›</span></button>`}</div>
      <label class="ai-lbl">Your name <input id="ai-name" maxlength="20" value="${esc(me.name)}" placeholder="e.g. Adam" /></label>
      ${me.squad ? `<p>In squad <b class="code">${esc(me.squad)}</b> · <button class="linkbtn" id="ai-leave">Leave</button></p>` : `
      <div class="ai-row"><button class="btn" id="ai-create">Create squad</button><input id="ai-code" maxlength="4" placeholder="CODE" autocapitalize="characters" /><button class="btn" id="ai-join">Join</button></div>`}
      <p class="small muted" id="ai-squad-msg">Friends with the same code see each other on the map and your game plan.</p>
    </section>
    <button class="btn primary ai-start" id="ai-start">Start ski day</button>
    <p class="small muted ai-note">Keep White Powder open with the screen on while you ski. iPhone pauses tracking when the phone locks.</p>
    ${hist.length ? `<section class="section"><h3>Past days</h3>${hist.slice(0, 10).map((h) => `
      <div class="card pad ai-past"><b>${esc(h.name)}</b> <span class="muted small">${new Date(h.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      <div class="small secondary">${h.stats.runs} runs · ${h.stats.vertFt.toLocaleString()} ft · top ${h.stats.topMph} mph · ${h.stats.lifts} lifts</div></div>`).join('')}</section>` : ''}`;
  // nearest default
  const sel = document.getElementById('ai-mtn');
  const pick = (lat, lon) => { const best = mts.map((m) => [m, Math.hypot(m.lat - lat, (m.lon - lon) * Math.cos(lat * Math.PI / 180))]).sort((a, b) => a[1] - b[1])[0]; if (best) sel.value = best[0].id; };
  const home = getHome(); if (home) pick(home.lat, home.lon);
  document.getElementById('ai-near').addEventListener('click', () => navigator.geolocation?.getCurrentPosition((g) => pick(g.coords.latitude, g.coords.longitude), () => alert('Couldn\'t get your location.'), { enableHighAccuracy: true, timeout: 10000 }));
  app.querySelectorAll('[data-pref] button').forEach((b) => b.addEventListener('click', () => {
    setAiPrefs({ [b.closest('[data-pref]').dataset.pref]: b.dataset.v });
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  document.getElementById('ai-alerts').addEventListener('change', (e) => { setAiPrefs({ alerts: e.target.checked }); if (e.target.checked) askNotify(); });
  document.getElementById('ai-name').addEventListener('change', (e) => setAiMe({ name: e.target.value.trim() }));
  document.getElementById('ai-av-edit')?.addEventListener('click', () => openAvatarBuilder(() => renderAI()));
  const smsg = (t) => { document.getElementById('ai-squad-msg').textContent = t; };
  const squadCall = async (body) => {
    const r = await fetch('/api/squad', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 501) throw new Error('Squads need a one-time setup (free Upstash account) — ask Adam.');
    if (!r.ok) throw new Error(j.error || 'Squad server error');
    return j;
  };
  document.getElementById('ai-create')?.addEventListener('click', async () => {
    try { const j = await squadCall({ action: 'create' }); setAiMe({ squad: j.code }); renderAI(); } catch (e) { smsg(e.message); }
  });
  document.getElementById('ai-join')?.addEventListener('click', async () => {
    const code = document.getElementById('ai-code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) return smsg('Codes are 4 letters.');
    try {
      const r = await fetch(`/api/squad?code=${code}`); const j = await r.json();
      if (r.status === 501) throw new Error('Squads need a one-time setup (free Upstash account) — ask Adam.');
      if (!j.exists) return smsg('No squad with that code (they expire overnight).');
      setAiMe({ squad: code }); renderAI();
    } catch (e) { smsg(e.message); }
  });
  document.getElementById('ai-leave')?.addEventListener('click', () => { squadCall({ action: 'leave', code: me.squad, id: me.id }).catch(() => {}); setAiMe({ squad: '' }); renderAI(); });
  document.getElementById('ai-start').addEventListener('click', () => {
    const m = mts.find((x) => x.id === sel.value);
    const d = { id: m.id, name: m.name, lat: m.lat, lon: m.lon, liftie: m.liftie, start: Date.now(), tracker: null };
    try { localStorage.setItem(AI_DAY_KEY, JSON.stringify(d)); } catch {}
    if (aiPrefs().alerts) askNotify();
    renderAI();
  });
}

function askNotify() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}
async function aiNotify(title, body) {
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  const b = document.getElementById('ai-banner');
  if (b) { b.innerHTML = `<b>${esc(title)}</b> ${esc(body)}`; b.hidden = false; setTimeout(() => { b.hidden = true; }, 15000); }
  try {
    if ('Notification' in window && Notification.permission === 'granted') (await navigator.serviceWorker?.ready)?.showNotification(title, { body, icon: '/icons/icon-192.png', tag: 'powder-ai' });
  } catch {}
}

function renderAIDay(day) {
  app.innerHTML = `
    <div class="ai-head">
      <div><h1 class="title ai-title brand-title" style="margin:0">${esc(day.name)}</h1><div class="small muted" id="ai-clock"></div></div>
      <button class="btn sm" id="ai-end">End day</button>
    </div>
    <div class="ai-banner" id="ai-banner" hidden></div>
    <div class="ai-status" id="ai-status">Waiting for GPS…</div>
    <div class="card ai-mapcard"><div id="ai-map" class="ai-map"></div><button class="circ sm ai-recenter" id="ai-recenter" aria-label="Center on me">◎</button></div>
    <section class="card pad" id="ai-plan"></section>
    <section class="ai-stats" id="ai-stats"></section>
    <section class="card pad" id="ai-lines"></section>
    <section class="card pad" id="ai-squad"></section>
    <section class="section"><h3>Runs</h3><div id="ai-runs"></div></section>`;
  document.getElementById('ai-end').addEventListener('click', () => {
    if (!confirm('End your ski day and save the stats?')) return;
    const t = AI.tracker;
    if (t) {
      t.finish();
      const h = (() => { try { return JSON.parse(localStorage.getItem(AI_HIST_KEY) || '[]'); } catch { return []; } })();
      h.unshift({ name: day.name, start: t.start || day.start, stats: t.stats() });
      try { localStorage.setItem(AI_HIST_KEY, JSON.stringify(h.slice(0, 60))); } catch {}
    }
    localStorage.removeItem(AI_DAY_KEY); stopTracking(); renderAI();
  });
  document.getElementById('ai-recenter').addEventListener('click', () => {
    const f = AI.lastFix; if (!AI.map) return;
    const up = upBearing(AI.area); AI.facing = aiFacing();
    AI.map.easeTo({ center: f ? [f.lon, f.lat] : AI.map.getCenter(), zoom: f ? 15.2 : AI.map.getZoom(), pitch: 58, bearing: AI.facing === 'up' ? up : (up + 180) % 360, duration: 900 });
  });
  // Tracking keeps running while you look at forecasts; coming back just redraws.
  if (AI.watch != null && AI.dayId === day.id) { try { AI.map?.remove(); } catch {} AI.map = null; drawAIMap(day); aiUpdate(true); return; }
  startTracking(day);
  AI.dayId = day.id;
}

async function startTracking(day) {
  stopTracking(true);
  // tracker (resume from saved state if the app was reloaded)
  AI.tracker = new DayTracker({ saved: day.tracker || null });
  AI.tracker.start ??= day.start;
  // map geometry + live feed
  loadSkiArea(day.id, day.lat, day.lon).then((area) => { AI.area = area; AI.tracker.area = area; drawAIMap(day); aiUpdate(); }).catch(() => { AI.err = 'Trail map data unavailable — stats still track.'; drawAIMap(day); aiUpdate(); });
  const pullFeed = async () => {
    if (!day.liftie) return;
    try { AI.feed = await getJSON(`/api/status?id=${encodeURIComponent(day.liftie)}&ai=1`); AI.tracker.resortRuns = AI.feed.runs || []; } catch {}
    aiUpdate(true);
  };
  pullFeed(); AI.timers.push(setInterval(pullFeed, 120000));
  // GPS
  if (!navigator.geolocation) { AI.err = 'This device has no GPS access.'; aiUpdate(); return; }
  AI.watch = navigator.geolocation.watchPosition((g) => {
    const c = g.coords;
    aiOnFix({ t: g.timestamp, lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, speed: c.speed });
  }, (e) => { AI.err = e.code === 1 ? 'Location is off for White Powder. Allow it in Settings → Privacy → Location → Safari Websites.' : 'Looking for GPS…'; aiUpdate(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  if (location.hostname === 'localhost') window.__aiFeed = aiOnFix; // test hook: replay a recorded day
  function aiOnFix(f) {
    AI.lastFix = { lat: f.lat, lon: f.lon, acc: f.acc, t: f.t };
    const ev = AI.tracker.add(f);
    if (ev?.type === 'run') aiToast(`Run ${AI.tracker.runs.length}: ${ev.run.name || 'run'} · ${ev.run.dropFt.toLocaleString()} ft · top ${ev.run.topMph} mph`);
    if (ev?.type === 'ride') aiToast(`Lift ${AI.tracker.rides.length}${ev.ride.name ? `: ${ev.ride.name}` : ''} · +${ev.ride.climbFt.toLocaleString()} ft`);
    if (ev && (ev.type === 'state' || ev.type === 'run' || ev.type === 'ride')) aiUpdate(true); else aiUpdate();
    if (Date.now() - AI.lastSave > 15000) saveAIDay();
  }
  // keep the screen awake
  const wake = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') AI.wake = await navigator.wakeLock.request('screen'); } catch {} };
  wake(); AI.onVis = () => { if (document.visibilityState === 'visible') wake(); else saveAIDay(); };
  document.addEventListener('visibilitychange', AI.onVis);
  // re-plan every minute; squad sync every 20 s
  AI.timers.push(setInterval(() => aiUpdate(true), 60000));
  AI.timers.push(setInterval(syncSquad, 20000)); syncSquad();
  AI.timers.push(setInterval(() => { const el = document.getElementById('ai-clock'); if (el) el.textContent = aiClock(); }, 30000));
}

function stopTracking(keepDay) {
  if (AI.watch != null) navigator.geolocation?.clearWatch(AI.watch);
  AI.watch = null; AI.timers.forEach(clearInterval); AI.timers = [];
  try { AI.wake?.release(); } catch {}
  AI.wake = null;
  if (AI.onVis) document.removeEventListener('visibilitychange', AI.onVis);
  if (!keepDay && AI.tracker) saveAIDay();
  try { AI.map?.remove?.(); } catch {} AI.map = null; AI.layers = null; AI.dayId = null;
}
function saveAIDay() {
  const d = aiDay(); if (!d || !AI.tracker) return;
  d.tracker = AI.tracker.toJSON(); AI.lastSave = Date.now();
  try { localStorage.setItem(AI_DAY_KEY, JSON.stringify(d)); } catch {}
}
const aiClock = () => { const t = AI.tracker; if (!t?.start) return ''; return `Out ${fmtMin(Math.round((Date.now() - t.start) / 60000))} · tracking${AI.wake ? ' · screen kept on' : ''}`; };
function aiToast(t) {
  const b = document.getElementById('ai-banner'); if (!b) return;
  b.textContent = t; b.hidden = false; clearTimeout(aiToast.t); aiToast.t = setTimeout(() => { b.hidden = true; }, 6000);
}

// ---------- 3D ski map (MapLibre): snow-white terrain, forests, hill shading, runs + lifts draped on the slopes ----------
let mlP;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  mlP ||= new Promise((resolve, reject) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/vendor/maplibre/maplibre-gl.css'; document.head.appendChild(l);
    const sc = document.createElement('script'); sc.src = '/vendor/maplibre/maplibre-gl.js'; sc.onload = resolve; sc.onerror = () => reject(new Error('map library failed to load'));
    document.head.appendChild(sc);
  });
  return mlP;
}
const DEM = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen/AWS' };
function skiStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, dem: DEM, shade: DEM },
    terrain: { source: 'dem', exaggeration: 1.45 },
    sky: { 'sky-color': '#9cc3f0', 'horizon-color': '#e8f1fb', 'fog-color': '#eef3f9', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35 },
    layers: [
      { id: 'snow', type: 'background', paint: { 'background-color': '#f6f8fb' } },
      { id: 'shade', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.75, 'hillshade-shadow-color': '#4d5f7a', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#8fa3bf', 'hillshade-illumination-direction': 315 } },
      { id: 'forest', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#2f5d3a', 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#8ec0e8' } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'minor', 'service']]], paint: { 'line-color': '#b9bec7', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 2.5] } },
      { id: 'bldg', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#b89a7a', 'fill-opacity': 0.85 } },
    ],
  };
}
const RUN_COL = ['match', ['get', 'diff'], 'green', '#16a34a', 'blue', '#2563eb', 'black', '#111111', 'expert', '#111111', '#2563eb'];
const fc = (features) => ({ type: 'FeatureCollection', features });
const lineF = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords.map(([la, lo]) => [lo, la]) } });

// Which way is "up the mountain": average direction of the lifts, bottom → top (degrees clockwise from north).
function upBearing(area) {
  let x = 0, y = 0;
  for (const l of area?.lifts || []) {
    const a = l.coords[0], b = l.coords[l.coords.length - 1];
    const dx = (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), dy = b[0] - a[0];
    x += dx; y += dy;
  }
  return x || y ? (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : 0;
}
// Summit at the top while you're below / riding up; base at the top once you're at the top or skiing down.
function aiFacing() {
  const t = AI.tracker, area = AI.area, f = AI.lastFix;
  if (!area?.lifts?.length || !f) return 'up';
  const p = [f.lat, f.lon];
  const near = (pts) => Math.min(...pts.map((c) => dist(p, c)));
  if (near(area.lifts.flatMap((l) => [l.coords[0], l.coords[l.coords.length - 1]])) > 3000) return 'up'; // away from the mountain
  if (t?.state === 'lift') return 'up';
  if (t?.state === 'run') return 'down';
  const top = near(area.lifts.map((l) => l.coords[l.coords.length - 1])), bottom = near(area.lifts.map((l) => l.coords[0]));
  return top < bottom && top < 250 ? 'down' : 'up';
}
function aiOrient(force) {
  const map = AI.map; if (!map || !AI.area) return;
  const facing = aiFacing();
  if (!force && facing === AI.facing) return;
  AI.facing = facing;
  const up = upBearing(AI.area);
  map.easeTo({ bearing: facing === 'up' ? up : (up + 180) % 360, pitch: 58, duration: force ? 0 : 1400 });
}

async function drawAIMap(day) {
  const el = document.getElementById('ai-map');
  if (!el) return;
  try { await loadMapLibre(); } catch { el.innerHTML = '<p class="pad small muted">Map unavailable.</p>'; return; }
  if (!document.body.contains(el)) return;
  if (AI.map) { try { AI.map.remove(); } catch {} }
  let map;
  try {
    map = new maplibregl.Map({ container: el, style: skiStyle(), center: [day.lon, day.lat], zoom: 13.6, pitch: 58, bearing: upBearing(AI.area), maxPitch: 75, attributionControl: { compact: true }, antialias: true, fadeDuration: 0 });
  } catch { el.innerHTML = '<p class="pad small muted">3D map needs WebGL, which isn\'t available here.</p>'; return; }
  AI.map = map; AI.layers = { me: null, mates: [], lifts: [] }; AI.facing = null;
  if (location.hostname === 'localhost') window.__aiMap = map;
  map.once('style.load', () => {
    map.addSource('runs', { type: 'geojson', data: fc((AI.area?.runs || []).map((r) => lineF(r.coords, { name: r.name, diff: r.diff }))) });
    map.addSource('lifts', { type: 'geojson', data: fc([]) });
    map.addSource('track', { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'runs-casing', type: 'line', source: 'runs', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 7], 'line-opacity': 0.8 } });
    map.addLayer({ id: 'runs', type: 'line', source: 'runs', paint: { 'line-color': RUN_COL, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 4], 'line-dasharray': ['case', ['==', ['get', 'diff'], 'expert'], ['literal', [2, 1.2]], ['literal', [1, 0]]] } });
    map.addLayer({ id: 'run-names', type: 'symbol', source: 'runs', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-keep-upright': true },
      paint: { 'text-color': RUN_COL, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
    map.addLayer({ id: 'lifts', type: 'line', source: 'lifts', paint: { 'line-color': ['case', ['get', 'closed'], '#9ca3af', '#dc2626'], 'line-width': 2.6 } });
    map.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f59e0b', 'line-width': 3.5 } });
    if (AI.area?.lifts?.length) {
      const ll = AI.area.lifts.flatMap((l) => l.coords.map(([la, lo]) => [lo, la]));
      const b = ll.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(ll[0], ll[0]));
      map.fitBounds(b, { padding: 30, pitch: 58, bearing: upBearing(AI.area), duration: 0 });
    }
    AI.facing = null; aiOrient(true);
    aiUpdate(true);
  });
}

function aiMapLifts() {
  const map = AI.map; if (!map || !AI.area || !map.getSource('lifts')) return;
  const feats = [];
  AI.layers.lifts.forEach((m) => m.remove()); AI.layers.lifts = [];
  for (const l of AI.area.lifts) {
    const f = feedFor(l, AI.feed?.lifts);
    const closed = !!(f && f.status && f.status !== 'open');
    feats.push(lineF(l.coords, { name: l.name, closed }));
    const el = document.createElement('div');
    el.className = `ai-liftlbl${closed ? ' closed' : f?.wait >= 10 ? ' long' : ''}`;
    el.innerHTML = `${esc(l.name)}${f?.wait != null && !closed ? ` · <b>${f.wait}m</b>` : closed ? ' · closed' : ''}`;
    const [la, lo] = l.coords[0];
    AI.layers.lifts.push(new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([lo, la]).addTo(map));
  }
  map.getSource('lifts').setData(fc(feats));
}

function aiUpdate(full) {
  if (!location.hash.startsWith('#/ai')) return;
  const t = AI.tracker; if (!t) return;
  const day = aiDay(); if (!day) return;
  // status line
  const st = document.getElementById('ai-status');
  const last = t.pts[t.pts.length - 1];
  const cur = t.currentLift();
  if (st) {
    st.className = `ai-status ${t.state}`;
    st.textContent = AI.err && !last ? AI.err
      : !last ? 'Waiting for GPS…'
      : t.state === 'lift' ? `🚡 Riding ${cur?.lift.name || 'a lift'}`
      : t.state === 'run' ? `⛷️ Skiing · ${Math.round((last.v || 0) * 2.237)} mph`
      : '⏸ Standing by';
  }
  const clock = document.getElementById('ai-clock'); if (clock) clock.textContent = aiClock();
  // map: track + me
  if (AI.map && AI.layers && AI.map.getSource?.('track')) {
    AI.map.getSource('track').setData(fc(t.pts.length > 1 ? [lineF(t.pts.map((p) => [p.lat, p.lon]), {})] : []));
    if (AI.lastFix) {
      const ll = [AI.lastFix.lon, AI.lastFix.lat];
      if (!AI.layers.me) { const d = document.createElement('div'); d.className = 'ai-me'; AI.layers.me = new maplibregl.Marker({ element: d }).setLngLat(ll).addTo(AI.map); }
      else AI.layers.me.setLngLat(ll);
    }
    if (full) aiMapLifts();
    aiOrient();
  }
  if (full) aiPlan(cur, last);
  // stats
  const s = t.stats();
  const tile = (v, k) => `<div class="ai-stat"><b>${v}</b><span>${k}</span></div>`;
  const se = document.getElementById('ai-stats');
  if (se) se.innerHTML = [
    tile(s.runs, 'Runs'), tile(s.vertFt.toLocaleString(), 'Vertical ft'), tile(s.lifts, 'Lifts'), tile(`${s.topMph}`, 'Top mph'),
    tile(`${s.avgMph}`, 'Avg mph'), tile(`${s.skiMi}`, 'Miles skied'), tile(fmtMin(s.skiMin), 'Time skiing'), tile(s.peakFt ? s.peakFt.toLocaleString() : '—', 'Peak ft'),
    tile(s.vertPerHour.toLocaleString(), 'Vert ft / hr'), tile(fmtMin(s.liftMin), 'On lifts'), tile(s.groomedRuns, 'Groomed runs'), tile(s.avgRating ?? '—', 'Avg rating'),
  ].join('') + (s.longest ? `<div class="ai-best small secondary">Longest run: <b>${esc(s.longest.name || 'unnamed')}</b> (${s.longest.distMi} mi)${s.favLift ? ` · Most ridden: <b>${esc(s.favLift)}</b>` : ''}</div>` : '');
  // runs list
  const re = document.getElementById('ai-runs');
  if (re && (full || re.childElementCount !== t.runs.length)) {
    re.innerHTML = t.runs.length ? t.runs.map((r, i) => `
      <div class="card ai-run">
        <div><b>${i + 1}. ${esc(r.name || 'Unnamed run')}</b> <span class="small">${DIFF_DOT[r.diff] || ''}</span>${r.groomed === true ? ' <span class="ai-tag">groomed</span>' : r.groomed === false ? ' <span class="ai-tag pow">ungroomed</span>' : ''}
        <div class="small secondary">${r.dropFt.toLocaleString()} ft · ${r.distMi} mi · top ${r.topMph} mph · avg ${r.avgMph} mph · ${new Date(r.t0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div></div>
        <div class="ai-rate" data-run="${i}">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" class="${r.rating >= n ? 'on' : ''}" aria-label="Rate ${n}">❄</button>`).join('')}</div>
      </div>`).reverse().join('') : '<p class="small muted">Your runs show up here as you ski. Rate each one 1–5 ❄.</p>';
    re.querySelectorAll('.ai-rate button').forEach((b) => b.addEventListener('click', () => {
      const run = t.runs[Number(b.parentElement.dataset.run)]; run.rating = Number(b.dataset.n); saveAIDay(); aiUpdate(true);
    }));
  }
  // lift lines
  const le = document.getElementById('ai-lines');
  if (le && full) {
    const ls = (AI.feed?.lifts || []).filter((l) => l.status === 'open');
    const withWait = ls.filter((l) => l.wait != null).sort((a, b) => a.wait - b.wait);
    le.innerHTML = `<h3 style="margin:0 0 6px">Lift lines now</h3>` + (withWait.length
      ? `<div class="ai-chips">${withWait.map((l) => `<span class="ai-chip ${l.wait >= 10 ? 'long' : l.wait <= 2 ? 'short' : ''}">${esc(l.name.replace(/^#\d+\s*/, ''))} <b>${l.wait}m</b></span>`).join('')}</div>`
      : `<p class="small muted">${AI.feed?.found ? `${ls.length} lifts open · this resort doesn't publish wait times.` : 'Live lift data isn\'t available for this mountain.'}</p>`);
  }
  renderSquad();
}

function aiPlan(cur, last) {
  const pe = document.getElementById('ai-plan'); if (!pe) return;
  const t = AI.tracker, p = aiPrefs();
  if (!AI.area) { pe.innerHTML = `<h3 style="margin:0">Game plan</h3><p class="small muted">${AI.err || 'Loading the trail map…'}</p>`; return; }
  const from = cur ? cur.lift.coords[cur.lift.coords.length - 1] : last ? [last.lat, last.lon] : null;
  if (!from) { pe.innerHTML = '<h3 style="margin:0">Game plan</h3><p class="small muted">Waiting for your location…</p>'; return; }
  const doneLifts = new Map(); t.rides.forEach((r) => r.name && doneLifts.set(r.name, (doneLifts.get(r.name) || 0) + 1));
  const opts = plan(AI.area, from, { feedLifts: AI.feed?.lifts, resortRuns: AI.feed?.runs, level: p.level, snow: p.snow, doneRuns: new Set(t.runs.map((r) => r.name)), doneLifts });
  // better-line alert: the lift we suggested now has a much longer line than the new best
  const prev = AI.shownBest, best = opts[0];
  if (p.alerts && prev && best && prev.lift.name !== best.lift.name) {
    const pf = feedFor(prev.lift, AI.feed?.lifts);
    const pw = pf?.status && pf.status !== 'open' ? 99 : pf?.wait ?? null;
    if (pw != null && best.wait != null && pw - best.wait >= 5) aiNotify('Better line opened', `${best.lift.name} is ${best.wait} min vs ${pw >= 99 ? 'closed' : `${pw} min`} at ${prev.lift.name}.`);
  }
  AI.plan = opts; AI.shownBest = best || null;
  pe.innerHTML = `<h3 style="margin:0 0 4px">${cur ? `Game plan from the top of ${esc(cur.lift.name)}` : 'Game plan from here'}</h3>
    <div class="small muted" style="margin-bottom:8px">${AI_LEVELS[p.level]} · ${SNOW[p.snow]} snow · <a href="#/ai" id="ai-prefs">change</a></div>
    ${opts.length ? opts.map((o, i) => `<div class="ai-opt${i ? '' : ' best'}">
      <div class="ai-opt-n">${i + 1}</div>
      <div><div>${o.run ? `Ski <b>${esc(o.run.name || 'the run below')}</b> ${DIFF_DOT[o.run.diff] || ''} → ` : 'Head to '}<b>${esc(o.lift.name)}</b>${o.wait != null ? ` · <span class="${o.wait >= 10 ? 'err' : 'good'}">${o.wait} min line</span>` : ''}</div>
      <div class="small muted">${o.why.slice(0, 3).map(esc).join(' · ')}</div></div></div>`).join('')
      : '<p class="small muted">No connected runs found from here yet — keep skiing and I\'ll update.</p>'}
    ${aiMe().squad && opts[0] ? '<button class="btn sm" id="ai-shareplan">📣 Send plan to squad</button>' : ''}`;
  document.getElementById('ai-prefs')?.addEventListener('click', (e) => { e.preventDefault(); aiPrefSheet(); });
  document.getElementById('ai-shareplan')?.addEventListener('click', () => { AI.sharedPlan = planText(opts[0]); syncSquad(); aiToast('Plan sent to your squad.'); });
}
const planText = (o) => (o ? `${o.run ? `${o.run.name || 'run'} → ` : ''}${o.lift.name}${o.wait != null ? ` (${o.wait}m)` : ''}` : '');

function aiPrefSheet() {
  const p = aiPrefs();
  const el = modal(`<h3>Game plan settings</h3>
    <div class="ai-lbl">Terrain<div class="seg-ctl ai-seg" data-pref="level">${Object.entries(AI_LEVELS).map(([k, v]) => `<button data-v="${k}" class="${k === p.level ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <div class="ai-lbl">Snow<div class="seg-ctl ai-seg" data-pref="snow">${Object.entries(SNOW).map(([k, v]) => `<button data-v="${k}" class="${k === p.snow ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    <label class="opt"><input type="checkbox" id="ai-al2" ${p.alerts ? 'checked' : ''}/> Better-line alerts</label>
    <button class="btn primary" id="ai-ok">Done</button>`);
  el.querySelectorAll('[data-pref] button').forEach((b) => b.addEventListener('click', () => { setAiPrefs({ [b.closest('[data-pref]').dataset.pref]: b.dataset.v }); b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }));
  el.querySelector('#ai-al2').addEventListener('change', (e) => { setAiPrefs({ alerts: e.target.checked }); if (e.target.checked) askNotify(); });
  el.querySelector('#ai-ok').addEventListener('click', () => { el.remove(); AI.shownBest = null; aiUpdate(true); });
}

// ---------- Rider avatar: build your skier/snowboarder; your squad sees it on the map ----------
const myAv = () => decodeAv(aiMe().av);
const ROASTS = [
  (a, n) => `${n} has been "almost ready" in the parking lot for 25 minutes.`,
  (a, n) => `${n} will tell you about the one powder day in 2019. Again.`,
  (a, n) => `${n}'s ${avRide(a) === 'board' ? 'board' : 'skis'} cost more than their car's last repair.`,
  (a, n) => `${n} calls every groomer "basically powder".`,
  (a, n) => `${n} has a goggle tan they're weirdly proud of.`,
  (a, n) => `${n} is ${avRide(a) === 'board' ? 'sitting in the middle of the run' : 'merging without signaling'} right now.`,
  (a, n) => `${n} packed three snacks and zero sunscreen.`,
  (a, n) => `${n} says "one more run" like it's a legally binding contract.`,
];
const roast = (a, n) => { const k = [...(a.title + a.move)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, a.acc.length); return ROASTS[k % ROASTS.length](a, n || 'This rider'); };
function riderCard(a, name, big) {
  return `<div class="rider ${big ? 'big' : ''}">${avatarSvg(a, { size: big ? 150 : 64, cls: 'av-bob' })}
    <div class="rider-txt"><b>${esc(name || 'Mystery rider')}</b><span class="rider-title">${esc(avTitle(a))}</span>
    <span class="small muted">Signature move: <b>${esc(avMove(a))}</b></span><span class="small muted">Gnar level: ${esc(avGnar(a))}</span></div></div>`;
}
// 3D viewer: a real-time WebGL model (three.js, lazy-loaded) — one context per builder, rebuilt in place on every change.
// Falls back to the flat drawing if WebGL isn't available.
let rider3dMod = null;
async function mountViewer(host, a) {
  const { o, P } = palette3d(a);
  if (!host.querySelector('.av3d')) {
    host.innerHTML = `<div class="av3d" aria-label="3D rider preview — drag to spin"><div class="av3d-gl"></div>
      <button class="av3d-trick" type="button"></button><span class="av3d-hint">drag to spin</span><div class="av3d-flat"></div></div>`;
    host.querySelector('.av3d-trick').addEventListener('click', () => host._viewer?.trick());
  }
  host.querySelector('.av3d-trick').textContent = o.ride === 1 ? '🏂 Trick' : '⛷️ Trick';
  const flat = host.querySelector('.av3d-flat');
  if (host._viewer) { host._viewer.update(o, P); return; }
  flat.innerHTML = avatarSvg(o, { size: 150 }); // shows instantly while the 3D engine loads
  try {
    rider3dMod ||= await import('/vendor/rider3d.js');
    if (!host.isConnected) return;
    if (!host._viewer) host._viewer = rider3dMod.createRiderViewer(host.querySelector('.av3d-gl'));
    host._viewer.update(...Object.values(palette3d(host._av || a)));
    flat.innerHTML = '';
  } catch (e) { console.warn('3D viewer unavailable', e); host.querySelector('.av3d-hint').textContent = ''; }
  host._av = a;
}

function openAvatarBuilder(onDone, startTab = 'ride') {
  let a = normAv(myAv() || randomAvatar());
  const me = aiMe();
  let tab = startTab;
  const sw = (k, colors) => `<div class="av-sw" data-k="${k}">${colors.map((c, i) => `<button style="--c:${Array.isArray(c) ? `linear-gradient(135deg,${c[0]},${c[1]})` : c}" data-i="${i}" aria-label="${k} ${i + 1}"></button>`).join('')}</div>`;
  const chips = (k, list) => `<div class="av-chips wrap" data-k="${k}">${list.map((t, i) => `<button data-i="${i}">${esc(Array.isArray(t) ? t[1] : t)}</button>`).join('')}</div>`;
  const sec = (h, inner) => `<div class="av-sec"><h4>${h}</h4>${inner}</div>`;
  const TABS = {
    ride: ['Ride', () => sec('I ride', chips('ride', AV.ride)) + sec('Build (no judgment)', chips('build', AV.build)) + sec('Skin', sw('skin', AV.skin)) + sec(`${a.ride === 1 ? 'Board' : 'Skis'} & helmet color`, sw('helmet', AV.color))
      + `<label class="opt"><input type="checkbox" data-acc="stickers" ${a.acc.includes('stickers') ? 'checked' : ''}/> Sticker-bomb my ${a.ride === 1 ? 'board' : 'skis'} and helmet</label>`],
    head: ['Head', () => sec('Helmet / hat', chips('helmStyle', AV.helmStyle)) + sec('Eyewear', chips('eyewear', AV.eyewear)) + sec('Lens', sw('lens', AV.lens.map((l) => [l[0], l[1]])))],
    fit: ['Outfit', () => sec('Jacket', chips('jacketStyle', AV.jacketStyle)) + sec('Jacket color', sw('jacket', AV.color)) + sec('Accent color (stripes, hoods, packs, scarves)', sw('accent', AV.color))
      + sec('Pants', chips('pantsStyle', AV.pantsStyle)) + (a.jacketStyle === 2 ? '' : sec('Pants color', sw('pants', AV.color))) + sec('Gloves', sw('gloves', AV.color))],
    acc: ['Add-ons', () => holidayChips() + `<p class="small muted" style="margin:4px 0 8px">Pile on as many as you want — tap again to remove.</p><div class="av-chips wrap">${ACC.map(([k, l]) => `<button data-acc="${k}" class="${a.acc.includes(k) ? 'on' : ''}">${a.acc.includes(k) ? '✓ ' : '+ '}${esc(l)}</button>`).join('')}</div>`
      + (a.acc.filter((k) => !ACC.some((x) => x[0] === k) && !hol.some((h) => h.props.includes(k))).length ? `<h4 class="av-past">Holiday props you're wearing</h4><div class="av-chips wrap">${a.acc.filter((k) => !ACC.some((x) => x[0] === k) && !hol.some((h) => h.props.includes(k))).map((k) => `<button data-acc="${k}" class="on">✓ ${esc(accLabel(k))}</button>`).join('')}</div>` : '')
      + (a.acc.length ? `<button class="linkbtn" id="av-clear" style="margin-top:8px">Remove all add-ons</button>` : '')],
    me: ['Persona', () => sec('Your name', `<input id="av-name" maxlength="20" placeholder="Your name" value="${esc(aiMe().name || '')}" />`)
      + sec('Title', `<input id="av-title" maxlength="32" value="${esc(a.title)}" placeholder="Write your own title"/>${chipsTxt('title', AV.title)}`)
      + sec('Signature move', `<input id="av-move" maxlength="32" value="${esc(a.move)}" placeholder="Write your own move"/>${chipsTxt('move', AV.move)}`)
      + sec('Birthday (for birthday props 🎂)', `<input id="av-bday" type="date" value="${aiMe().bday ? `2000-${aiMe().bday}` : ''}"/>`)
      + sec('Gnar level', `<input type="range" id="av-gnar" min="0" max="${AV.gnar.length - 1}" value="${a.gnar}"/><div class="small muted" id="av-gnar-l">${esc(avGnar(a))}</div>`)],
  };
  const hol = holidaysOn(new Date(), aiMe().bday);
  function holidayChips() {
    return hol.map((h) => `<div class="av-holiday"><div class="av-hol-h">${h.emoji} <b>${esc(h.name)}</b> <span>limited-time props</span></div>
      <div class="av-chips wrap">${h.props.map((k) => `<button data-acc="${k}" class="hol ${a.acc.includes(k) ? 'on' : ''}">${a.acc.includes(k) ? '✓ ' : '+ '}${esc(accLabel(k))}</button>`).join('')}</div></div>`).join('');
  }
  function chipsTxt(k, list) { return `<div class="av-chips" data-txt="${k}">${list.map((t) => `<button data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>`; }
  const m = modal(`<div class="av-build">
    <div class="cam-h"><b>Build your rider</b><button class="circ sm" id="av-x" aria-label="Close">✕</button></div>
    <div id="av-view"></div>
    <div class="av-id"><b id="av-n"></b><span class="rider-title" id="av-t"></span><span class="small muted" id="av-mv"></span></div>
    <div class="av-roast small" id="av-roast"></div>
    ${hol.length ? `<button class="av-hol-banner" id="av-hol">${hol.map((h) => h.emoji).join(' ')} ${esc(hol[0].name)}! Holiday props are here <span>Try them ›</span></button>` : ''}
    <div class="av-tabs">${Object.entries(TABS).map(([k, [l]]) => `<button data-tab="${k}">${l}</button>`).join('')}<button id="av-dice" title="Shuffle">🎲</button></div>
    <div id="av-panel"></div>
    <button class="btn primary" id="av-save" style="width:100%;margin-top:10px">Save rider</button>
    <p class="small muted" style="text-align:center;margin:8px 0 0">Your squad sees your rider on the Powder AI map.</p>
  </div>`);
  m.classList.add('av-modal');
  const nameNow = () => (m.querySelector('#av-name')?.value ?? aiMe().name ?? '').trim();
  let pendingName = aiMe().name || '';
  const refresh = (rebuildPanel) => {
    a = normAv(a);
    const vh = m.querySelector('#av-view'); vh._av = a; mountViewer(vh, a);
    m.querySelector('#av-n').textContent = pendingName || 'Mystery rider';
    m.querySelector('#av-t').textContent = a.title;
    m.querySelector('#av-mv').textContent = `Signature move: ${a.move}`;
    m.querySelector('#av-roast').textContent = roast(a, pendingName);
    if (rebuildPanel) panel();
    m.querySelectorAll('[data-k]').forEach((g) => g.querySelectorAll('[data-i]').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === a[g.dataset.k])));
    m.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  };
  function panel() {
    const p = m.querySelector('#av-panel'); p.innerHTML = TABS[tab][1]();
    p.querySelectorAll('[data-k] [data-i]').forEach((b) => b.addEventListener('click', () => {
      const k = b.closest('[data-k]').dataset.k; a = { ...a, [k]: Number(b.dataset.i) };
      refresh(k === 'ride' || k === 'jacketStyle');
    }));
    p.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener(b.tagName === 'INPUT' ? 'change' : 'click', () => {
      const k = b.dataset.acc; a = { ...a, acc: a.acc.includes(k) ? a.acc.filter((x) => x !== k) : [...a.acc, k] };
      refresh(true);
    }));
    p.querySelector('#av-clear')?.addEventListener('click', () => { a = { ...a, acc: [] }; refresh(true); });
    p.querySelector('#av-name')?.addEventListener('input', (e) => { pendingName = e.target.value.trim(); refresh(false); });
    for (const k of ['title', 'move']) {
      const inp = p.querySelector(`#av-${k}`);
      inp?.addEventListener('input', () => { a = { ...a, [k]: inp.value }; m.querySelector(k === 'title' ? '#av-t' : '#av-mv').textContent = k === 'title' ? inp.value : `Signature move: ${inp.value}`; m.querySelector('#av-roast').textContent = roast(normAv(a), pendingName); });
      p.querySelectorAll(`[data-txt="${k}"] button`).forEach((b) => b.addEventListener('click', () => { a = { ...a, [k]: b.dataset.t }; inp.value = b.dataset.t; refresh(false); }));
    }
    p.querySelector('#av-bday')?.addEventListener('change', (e) => { const v = e.target.value; setAiMe({ bday: v ? v.slice(5) : '' }); });
    p.querySelector('#av-gnar')?.addEventListener('input', (e) => { a = { ...a, gnar: Number(e.target.value) }; p.querySelector('#av-gnar-l').textContent = avGnar(a); });
  }
  m.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; refresh(true); }));
  m.querySelector('#av-hol')?.addEventListener('click', () => { tab = 'acc'; refresh(true); m.querySelector('.av-holiday')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  m.querySelector('#av-dice').addEventListener('click', () => {
    const keep = { title: a.title, move: a.move }; a = { ...randomAvatar() };
    if (tab === 'me') Object.assign(a, keep); // don't wipe text you're typing
    refresh(true); setTimeout(() => m.querySelector('#av-view')._viewer?.trick(), 50);
  });
  const close = () => { m.querySelector('#av-view')._viewer?.destroy(); m.remove(); };
  m.querySelector('#av-x').onclick = close;
  m.querySelector('#av-save').addEventListener('click', () => {
    a = normAv(a);
    setAiMe({ av: encodeAv(a), name: pendingName || aiMe().name });
    close(); if (AI.tracker) syncSquad(); onDone?.();
  });
  refresh(true);
}

async function syncSquad() {
  const me = aiMe(); if (!me.squad || !AI.tracker) return;
  const t = AI.tracker, f = AI.lastFix, cur = t.currentLift(), s = t.stats();
  try {
    await fetch('/api/squad', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update', code: me.squad,
      member: { id: me.id, name: me.name || 'Skier', av: me.av || '', lat: f?.lat, lon: f?.lon, state: t.state, lift: cur?.lift.name || '', plan: AI.sharedPlan || planText(AI.plan[0]), runs: s.runs, vertFt: s.vertFt } }) });
    const j = await (await fetch(`/api/squad?code=${me.squad}`)).json();
    AI.squad = (j.members || []).filter((m) => m.id !== me.id);
    AI.squadErr = '';
  } catch { AI.squadErr = 'Squad offline'; }
  renderSquad();
}
function renderSquad() {
  const el = document.getElementById('ai-squad'); if (!el) return;
  const me = aiMe();
  if (!me.squad) { el.innerHTML = '<h3 style="margin:0">Ski squad</h3><p class="small muted">Join or create a squad before starting your day to see friends here.</p>'; return; }
  el.innerHTML = `<h3 style="margin:0 0 6px">Squad <span class="code">${esc(me.squad)}</span></h3>` + (AI.squad.length
    ? AI.squad.map((m) => `<div class="ai-mate">${decodeAv(m.av) ? avatarSvg(decodeAv(m.av), { size: 40, mode: 'badge' }) : `<span class="ai-av">${esc((m.name || '?')[0])}</span>`}<div><b>${esc(m.name)}</b>${decodeAv(m.av) ? ` <span class="rider-title sm">${esc(avTitle(decodeAv(m.av)))}</span>` : ''} <span class="small muted">${m.state === 'lift' ? `🚡 ${esc(m.lift || 'on a lift')}` : m.state === 'run' ? '⛷️ skiing' : '⏸'} · ${Math.max(0, Math.round((Date.now() - m.at) / 60000))}m ago</span>
        <div class="small secondary">${m.runs} runs · ${Number(m.vertFt).toLocaleString()} ft${m.plan ? ` · next: ${esc(m.plan)}` : ''}</div></div></div>`).join('')
    : `<p class="small muted">${AI.squadErr || 'Nobody else in the squad is out yet. Share the code!'}</p>`);
  if (AI.map && AI.layers && window.maplibregl) {
    AI.layers.mates.forEach((x) => x.remove()); AI.layers.mates = [];
    for (const m of AI.squad) if (Number.isFinite(m.lat)) {
      const d = document.createElement('div'); d.title = m.name; const av = decodeAv(m.av);
      if (av) { d.className = 'ai-matepin av-pin'; d.innerHTML = `${avatarSvg(av, { size: 38, mode: 'badge' })}<span>${esc(m.name || '')}</span>`; }
      else { d.className = 'ai-matepin'; d.textContent = (m.name || '?')[0]; }
      AI.layers.mates.push(new maplibregl.Marker({ element: d }).setLngLat([m.lon, m.lat]).addTo(AI.map));
    }
  }
}

// =====================================================================
// ---------- First Tracks: when to leave, road + chain conditions, route weather, cams, map links ----------
// =====================================================================
const VEH_KEY = 'wp:vehicle:v1', FT_KEY = 'wp:ft:v1';
const getVehicle = () => { try { const v = JSON.parse(localStorage.getItem(VEH_KEY) || 'null'); return v ? { ...VEHICLE_DEFAULT, ...v } : null; } catch { return null; } };
const setVehicle = (v) => { try { localStorage.setItem(VEH_KEY, JSON.stringify(v)); } catch {} };
const ftPrefs = () => { try { return { dest: '', day: 0, chair: '', goal: 'chair', route: 0, ...JSON.parse(localStorage.getItem(FT_KEY) || '{}') }; } catch { return { dest: '', day: 0, chair: '' }; } };
const setFt = (p) => { try { localStorage.setItem(FT_KEY, JSON.stringify({ ...ftPrefs(), ...p })); } catch {} };
const FIRST_CHAIR = { whistler: '08:30' };
const ftCache = new Map();
const VEH_LABEL = { '2wd': '2WD', awd: 'AWD', '4wd': '4WD' };

function vehicleEditor(v, id = 'veh') {
  const seg = (k, opts) => `<div class="seg-ctl ai-seg" data-veh="${k}">${Object.entries(opts).map(([x, l]) => `<button data-v="${x}" class="${String(v[k]) === x ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return `<div class="stack" id="${id}">
    <div class="ai-lbl">Drive${seg('drive', { '2wd': '2WD', awd: 'AWD', '4wd': '4WD' })}</div>
    <div class="ai-lbl">Tires${seg('tires', { allseason: 'All-season', snow: 'Snow (M+S / ❄︎)' })}</div>
    <div class="ai-lbl">Chains in the car${seg('chains', { true: 'Yes', false: 'No' })}</div>
  </div>`;
}
function wireVehicle(root, onChange) {
  root.querySelectorAll('[data-veh] button').forEach((b) => b.addEventListener('click', () => {
    const v = getVehicle() || { ...VEHICLE_DEFAULT };
    const k = b.closest('[data-veh]').dataset.veh;
    v[k] = k === 'chains' ? b.dataset.v === 'true' : b.dataset.v;
    setVehicle(v);
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange?.();
  }));
}

function renderDrive() {
  const p = ftPrefs(), home = getHome(), v = getVehicle();
  const mts = aiMountains();
  const favFirst = [...RESORTS.filter((r) => FAVS.has(r.id)).map((r) => r.id)];
  const dest = mts.find((m) => m.id === p.dest) || mts.find((m) => m.id === favFirst[0]) || mts[0];
  const chair = p.chair || FIRST_CHAIR[dest.id] || '09:00';
  const dayNames = [0, 1, 2, 3].map((k) => (k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : new Date(Date.now() + k * 864e5).toLocaleDateString('en-US', { weekday: 'short' })));
  app.innerHTML = `
    <h1 class="title ai-title brand-title">First Tracks</h1>
    <section class="card pad stack ft-controls">
      <label class="ai-lbl">Heading to <select id="ft-dest">${mts.map((m) => `<option value="${esc(m.id)}" ${m.id === dest.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <div class="ft-row"><button class="linkbtn" id="ft-from">📍 From ${home ? esc(home.label) : 'your location'} · change</button></div>
      <div class="seg-ctl ai-seg" id="ft-day">${dayNames.map((n, k) => `<button data-d="${k}" class="${k === p.day ? 'on' : ''}">${n}</button>`).join('')}</div>
      <label class="ai-lbl ft-inline">First chair <select id="ft-chair">${['07:30', '08:00', '08:30', '09:00', '09:30', '10:00'].map((t) => `<option ${t === chair ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${v ? `<div class="small secondary">🚙 ${VEH_LABEL[v.drive]} · ${v.tires === 'snow' ? 'snow tires' : 'all-season tires'} · ${v.chains ? 'chains in car' : 'no chains'} · <button class="linkbtn" id="ft-veh">edit</button></div>` : ''}
    </section>
    ${v ? '' : `<section class="card pad stack" id="ft-vehcard"><h3 style="margin:0">Your vehicle</h3><p class="small muted">Chain-control advice depends on it. Set it once (also in Settings).</p>${vehicleEditor({ ...VEHICLE_DEFAULT, drive: '', tires: '', chains: '' })}<button class="btn primary" id="ft-vehsave">Save vehicle</button></section>`}
    <div id="ft-body"><div class="card pad"><p class="muted">Planning your drive…</p></div></div>`;
  document.getElementById('ft-dest').addEventListener('change', (e) => { setFt({ dest: e.target.value, chair: '' }); renderDrive(); });
  document.getElementById('ft-chair').addEventListener('change', (e) => { setFt({ chair: e.target.value }); renderDrive(); });
  document.querySelectorAll('#ft-day button').forEach((b) => b.addEventListener('click', () => { setFt({ day: Number(b.dataset.d) }); renderDrive(); }));
  document.getElementById('ft-from').addEventListener('click', async () => { if (await askHome()) { ftCache.clear(); renderDrive(); } });
  document.getElementById('ft-veh')?.addEventListener('click', () => {
    const m = modal(`<h3>Your vehicle</h3>${vehicleEditor(getVehicle())}<button class="btn primary" id="veh-ok">Done</button>`);
    wireVehicle(m); m.querySelector('#veh-ok').onclick = () => { m.remove(); renderDrive(); };
  });
  const vc = document.getElementById('ft-vehcard');
  if (vc) { wireVehicle(vc); vc.querySelector('#ft-vehsave').onclick = () => { if (!getVehicle()) setVehicle({ ...VEHICLE_DEFAULT }); renderDrive(); }; }
  planDrive(dest, Number(p.day) || 0, chair);
}

// Short town name for a point ("Livermore, CA"), so you can see where a drive starts.
async function placeName(lat, lon) {
  try {
    const pr = (await (await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`)).json()).features?.[0]?.properties || {};
    const town = pr.city || pr.town || pr.village || pr.district || pr.county || pr.name;
    const st = ABBR[pr.state] || pr.state || '';
    return [town, st].filter(Boolean).join(', ');
  } catch { return ''; }
}
// "Your location" is live: GPS-based starting points refresh when they're more than 15 min old
// (a saved spot from days ago gave 16-hour drives). Typed addresses stay as set.
async function ftOrigin() {
  const h = getHome();
  const live = !h || h.gps || h.label === 'your location';
  if (h && !live) return [h.lat, h.lon];
  if (h && h.at && Date.now() - h.at < 15 * 60e3) return [h.lat, h.lon];
  const g = await new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((x) => res([x.coords.latitude, x.coords.longitude]), () => res(null), { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60e3 }) : res(null));
  if (g) {
    const moved = !h || Math.hypot(g[0] - h.lat, g[1] - h.lon) > 0.01;
    const label = moved || !h || h.label === 'your location' ? (await placeName(g[0], g[1])) || 'your location' : h.label;
    setHome({ lat: g[0], lon: g[1], label, gps: true, at: Date.now() });
    if (moved || label !== h?.label) { const b = document.getElementById('ft-from'); if (b) b.textContent = `📍 From ${label} · change`; }
    return g;
  }
  return h ? [h.lat, h.lon] : null;
}

let ftGen = 0;
async function planDrive(dest, dayOffset, chair) {
  // Each plan gets a ticket; if you switch mountain/day/time while a slow plan is still loading,
  // the old one must not paint over the new selection (that showed Whistler's 16-h drive under "Palisades").
  const gen = ++ftGen;
  const body = () => document.getElementById('ft-body');
  const stillHere = () => gen === ftGen && location.hash.startsWith('#/drive') && body();
  const from = await ftOrigin();
  if (!stillHere()) return;
  if (!from) { body().innerHTML = '<div class="card pad"><p>Set where you\'re starting from (📍 above) to plan the drive.</p></div>'; return; }
  const to = [dest.lat, dest.lon];
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const dayStart = day0.getTime() + dayOffset * 864e5;
  const [hh, mm] = chair.split(':').map(Number);
  // candidate departures for the traffic forecast: every 30 min in the 3 hours before first chair
  const key = `${from.join()}|${dest.id}|${dayOffset}|${chair}`;
  let d = ftCache.get(key);
  try {
    if (!d || Date.now() - d.at > 5 * 60e3) {
      const base = await getJSON(`/api/firsttracks?flat=${from[0]}&flon=${from[1]}&tlat=${to[0]}&tlon=${to[1]}`);
      const chairMs = dayStart + hh * 3600e3 + mm * 60e3;
      const departs = [];
      if (base.traffic) for (let k = 0; k < 10; k++) { const t = chairMs - 30 * 60e3 - base.routes[0].min * 60e3 - (240 - k * 30) * 60e3; if (t > Date.now()) { const dt = new Date(Math.round(t / 900e3) * 900e3); departs.push(new Date(dt.getTime() - dt.getTimezoneOffset() * 60e3).toISOString().slice(0, 19)); } } // local wall-clock time (TomTom reads it as the origin's time zone)
      const times = departs.length ? (await getJSON(`/api/firsttracks?flat=${from[0]}&flon=${from[1]}&tlat=${to[0]}&tlon=${to[1]}&departs=${departs.join(',')}`).catch(() => ({ times: [] }))).times : [];
      const pts = sampleRoute(base.routes[0].coords, 18);
      const wx = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${pts.map((x) => x.lat.toFixed(4)).join(',')}&longitude=${pts.map((x) => x.lon.toFixed(4)).join(',')}&hourly=temperature_2m,snowfall,precipitation,weather_code&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&forecast_days=5`).catch(() => null);
      const arr = Array.isArray(wx) ? wx : wx ? [wx] : [];
      const named = [...(base.chains || []), ...(base.passes || []), ...(base.cams || [])];
      const samples = pts.map((pt, i) => {
        const w = arr[i]; if (!w?.hourly) return null;
        const near = named.map((n) => ({ n, d: Math.hypot(n.lat - pt.lat, (n.lon - pt.lon) * Math.cos(pt.lat * Math.PI / 180)) })).sort((a, b) => a.d - b.d)[0];
        const name = pt.frac === 1 ? dest.name : near && near.d < 0.05 ? titleCase(near.n.place || near.n.name || '') : `Mile ${Math.round(pt.frac * base.routes[0].km * 0.621)}`;
        return { ...pt, name, elevFt: Math.round((w.elevation || 0) * 3.281), hourly: { t: w.hourly.time.map((x) => x * 1000), snow: w.hourly.snowfall, temp: w.hourly.temperature_2m, precip: w.hourly.precipitation, code: w.hourly.weather_code } };
      }).filter(Boolean);
      d = { at: Date.now(), base, times, samples: samples.filter(Boolean) }; // a failed weather lookup must not break the plan
      ftCache.set(key, d);
    }
  } catch (e) {
    if (stillHere()) body().innerHTML = `<div class="card pad"><p class="err">Couldn't plan the drive right now.</p><p class="small muted">${esc(e.message || e)}</p></div>`;
    return;
  }
  if (!stillHere()) return;
  const { base, times, samples } = d;
  const v = getVehicle() || { ...VEHICLE_DEFAULT };
  const route = base.routes[0];
  const live = dayOffset === 0 || (dayStart - Date.now() < 18 * 3600e3);
  const chains = base.chains.map((c) => ({ ...c, level: chainLevel(c.status, c.text) }));
  const chainMax = live ? Math.max(0, ...chains.map((c) => c.level)) : 0;
  const resortSample = samples.find((s) => s.frac === 1);
  const pow = powderPick(resortSample?.hourly, samples.filter((s) => s.frac < 1), 4);
  const powderDay = (pow.days.find((x) => x.day === dayStart)?.overnight || 0) >= 6;
  const goal = GOALS[ftPrefs().goal] ? ftPrefs().goal : 'chair';
  const plans = Object.fromEntries(Object.keys(GOALS).map((g) => [g, pickLeave({ goal: g, dayStart, firstChair: chair, baseMin: route.min, times, samples, chainLevelMax: chainMax, now: Date.now(), powderDay })]));
  const plan = plans[goal];
  const ri = Math.min(Number(ftPrefs().route) || 0, base.routes.length - 1);
  const stay = dayOffset >= 0 ? stayAdvice({ plan: plans.chair, samples, chainMax, powderInches: pow.days.find((x) => x.day === dayStart)?.overnight || 0, dayStart, weekend: [0, 6].includes(new Date(dayStart).getDay()) }) : null;
  const hl = hotelLinks(dest.name, dest.lat, dest.lon, dayStart);
  const inDay = (s) => s.hourly.t.map((t, i) => [t, i]).filter(([t]) => t >= plan.leave && t <= plan.arrive);
  const snowOnRoad = Math.max(0, ...samples.map((s) => inDay(s).reduce((a, [, i]) => a + (s.hourly.snow[i] || 0), 0)));
  const minTemp = Math.min(60, ...samples.flatMap((s) => inDay(s).map(([, i]) => s.hourly.temp[i])).filter(Number.isFinite));
  const bc = route.coords.some(([la, lo]) => la > 49.0 && lo < -114), wa = route.coords.some(([la, lo]) => la > 45.6 && la < 49 && lo < -116.9);
  const pack = packList({ v, chainMax, snowOnRoad, minTemp, bc, wa });
  const active = chains.filter((c) => c.level > 0);
  const passes = base.passes || [];
  const closures = (base.closures || []).filter((c) => c.full);
  const alerts = (base.alerts || []).filter((a) => a.closed || /CLOSURE|INCIDENT|MAJOR|closed/i.test(`${a.kind} ${a.text}`)).slice(0, 8);
  const aUrl = appleMapsUrl(from, dest.name, null);
  const fmtT = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const highest = [...samples].sort((a, b) => b.elevFt - a.elevFt).slice(0, 3);
  const wxRows = [...new Set([...highest, samples[samples.length - 1]])].filter(Boolean).sort((a, b) => a.frac - b.frac).map((s) => {
    const eta = plan.leave + s.frac * plan.driveMin * 60e3;
    const i = Math.max(0, s.hourly.t.findIndex((t) => t > eta) - 1);
    const snow = s.hourly.snow[i] || 0, temp = Math.round(s.hourly.temp[i]);
    return `<div class="ft-wx"><div><b>${esc(s.name)}</b><div class="small muted">${s.elevFt.toLocaleString()} ft · ~${fmtT(eta)}</div></div>
      <div class="ft-wx-v">${wmoIcon(s.hourly.code[i])} ${temp}°F${snow >= 0.05 ? ` · <b class="${snow >= 0.5 ? 'err' : ''}">${snow.toFixed(1)}"/hr</b>` : ''}</div></div>`;
  }).join('');
  body().innerHTML = `
    <section class="card pad ft-verdict">
      <div class="ft-leave-k">${plan.late ? 'Leave now' : `Leave by · ${GOALS[goal].label}`}</div>
      <div class="ft-leave">${plan.late ? fmtT(Date.now()) : fmtT(plan.leave)}</div>
      <ul class="ft-reasons">${plan.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${route.min > 540 ? `<p class="small ft-far">Starting from <b>${esc(getHome()?.label || 'your location')}</b> — that's ${Math.round(route.min / 60)}+ hours away. Not right? <button class="linkbtn" id="ft-fix">Change start</button></p>` : ''}
      <div class="ft-allgoals ft-goals" id="ft-goal">${Object.entries(GOALS).map(([k, g]) => `<button data-g="${k}" class="${k === goal ? 'on' : ''}"><span>${g.short}</span><b>${plans[k].late ? 'Now' : fmtT(plans[k].leave)}</b></button>`).join('')}</div>
      ${!base.traffic ? '<p class="small muted">Traffic isn\'t included yet (needs the free TomTom key).</p>' : ''}
      ${pow.best ? `<div class="ft-pow">❄️ Powder pick: <b>${pow.best.day === dayStart ? 'this day' : new Date(pow.best.day).toLocaleDateString('en-US', { weekday: 'long' })}</b> — ${pow.best.overnight.toFixed(0)}" overnight at ${esc(dest.name)}${pow.best.road >= 1 ? `, ${pow.best.road.toFixed(0)}" on the road that morning` : ', roads mostly clear'}.</div>` : ''}
    </section>
    ${stay ? `<section class="card pad ft-stay ${stay.strong ? 'strong' : ''}">
      <h3 style="margin:0 0 4px">${stay.strong ? 'Stay the night before?' : 'Worth considering: stay over'}</h3>
      <p class="small secondary" style="margin:0 0 8px">Because ${stay.why.map(esc).join(', ')}.</p>
      ${stay.evening ? `<p class="small" style="margin:0 0 8px">Best time to drive up the evening before: <b>${new Date(stay.evening.dep).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b>${stay.evening.snow < 0.1 ? ' — dry roads' : ` — lightest snow on the way (${stay.evening.snow.toFixed(1)}")`}.</p>` : ''}
      <div class="ft-maps"><a class="btn sm" href="${esc(hl.google)}" target="_blank" rel="noopener">Hotels · Google</a><a class="btn sm" href="${esc(hl.apple)}" target="_blank" rel="noopener">Hotels · Apple</a><a class="btn sm" href="${esc(hl.airbnb)}" target="_blank" rel="noopener">Airbnb</a></div>
    </section>` : ''}
    <section class="card pad">
      <h3 style="margin:0 0 6px">Chains & road conditions</h3>
      ${!live ? '<p class="small muted">Live chain controls apply to today; check again the night before.</p>' : ''}
      ${active.length ? active.map((c) => { const a = chainAdvice(c.level, v); return `<div class="ft-cc ${a.ok ? 'ok' : 'bad'}"><b>${esc(c.route || '')} · ${esc(titleCase(c.place || ''))}</b><div class="small">${esc(a.text)}</div></div>`; }).join('')
        : chains.length ? `<div class="ft-cc ok"><b>No chain controls on your route</b><div class="small muted">Checked ${chains.length} Caltrans chain-control points.</div></div>` : ''}
      ${passes.map((ps) => `<div class="ft-cc ${ps.restrictions.every((r) => passAdvice(r.text, v).ok) ? 'ok' : 'bad'}"><b>${esc(ps.name)}</b> <span class="small muted">${ps.elevFt ? `${ps.elevFt.toLocaleString()} ft` : ''}</span>
        <div class="small">${esc(ps.road || '')}${ps.weather ? ` · ${esc(ps.weather)}` : ''}</div>
        ${ps.restrictions.map((r) => `<div class="small"><b>${esc(r.dir || '')}:</b> ${esc(r.text)}</div>`).join('')}</div>`).join('')}
      ${closures.map((c) => `<div class="ft-cc bad"><b>Closure · ${esc(c.route || '')}</b><div class="small">${esc(titleCase(c.place || ''))} — ${esc(c.text)}</div></div>`).join('')}
      ${alerts.map((a) => `<div class="ft-cc ${a.closed ? 'bad' : 'warn'}"><b>${esc(a.route || 'Alert')}</b> <span class="small muted">${esc(a.kind || '')}</span><div class="small">${esc(String(a.text || '').slice(0, 220))}</div></div>`).join('')}
      ${bc ? `<div class="ft-cc ${v.tires === 'snow' ? 'ok' : 'warn'}"><b>BC winter tire rule</b><div class="small">Winter tires (M+S or mountain/snowflake) are required on Hwy 99 Oct 1 – Apr 30.</div></div>` : ''}
      ${!chains.length && !passes.length && !alerts.length && !bc ? '<p class="small muted">No live road-condition feed covers this route — check the state DOT before you go.</p>' : ''}
    </section>
    <section class="card pad"><h3 style="margin:0 0 6px">Weather on the drive</h3>${wxRows || '<p class="small muted">Weather unavailable.</p>'}</section>
    <section class="card pad"><h3 style="margin:0 0 6px">Pack for this trip</h3>
      ${pack.map((it) => `<label class="opt ft-pack ${it.must ? 'must' : ''}"><input type="checkbox"/> ${esc(it.t)}</label>`).join('')}</section>
    <section class="card pad"><h3 style="margin:0 0 6px">Routes</h3>
      <div class="ft-map" id="ft-map"></div>
      ${base.routes.map((r, k) => `<div class="ft-route ${k === ri ? 'sel' : ''}" data-r="${k}">
        <div class="ft-route-h"><span class="ft-swatch" style="background:${ROUTE_COL[k]}"></span><b>${k ? `Option ${k + 1}` : 'Fastest'}</b> · ${fmtDur(r.min)} · ${Math.round(r.km * 0.621)} mi${r.delayMin >= 3 ? ` · <span class="err">+${Math.round(r.delayMin)} min traffic now</span>` : ''}${routeVia(r, base.routes) ? `<div class="small muted">via ${esc(routeVia(r, base.routes))}</div>` : ''}</div>
        <div class="ft-maps"><a class="btn sm primary" href="${esc(googleMapsUrl(from, dest.name, null, r.coords))}" target="_blank" rel="noopener">Google Maps</a><a class="btn sm" href="${esc(aUrl)}" target="_blank" rel="noopener">Apple Maps</a></div>
      </div>`).join('')}
      <p class="small muted">Google Maps follows each route exactly. Apple Maps links can only take a start and destination, so Apple picks its own route.</p></section>
    ${base.cams.length ? `<section class="section"><h3>Cams along the way</h3><div class="ft-cams">${base.cams.map((c, i) => `<button class="ft-cam" data-cam="${i}"><img src="${esc(c.img)}" alt="" loading="lazy" onerror="this.closest('.ft-cam').remove()"/><span>${esc(titleCase(c.name || ''))}</span></button>`).join('')}</div></section>` : ''}
    <p class="small muted ft-src">Road data: ${[chains.length && 'Caltrans', passes.length && 'WSDOT', bc && 'DriveBC'].filter(Boolean).join(', ') || '—'} · Weather: Open-Meteo · ${base.traffic ? 'Traffic: TomTom' : 'Routing: OSRM'} · as of ${fmtT(Date.parse(base.fetchedAt))}</p>`;
  document.getElementById('ft-fix')?.addEventListener('click', async () => { if (await askHome()) { ftCache.clear(); renderDrive(); } });
  body().querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { setFt({ goal: b.dataset.g }); planDrive(dest, dayOffset, chair); }));
  body().querySelectorAll('.ft-route').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    setFt({ route: Number(el.dataset.r) });
    body().querySelectorAll('.ft-route').forEach((x) => x.classList.toggle('sel', x === el));
    drawRouteMap(base.routes, Number(el.dataset.r), from, to);
  }));
  drawRouteMap(base.routes, ri, from, to);
  body().querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
    const c = base.cams[Number(b.dataset.cam)];
    const m = modal(`<div class="cam-h"><b>${esc(titleCase(c.name || 'Highway cam'))}</b><button class="circ sm" id="fc-x" aria-label="Close">✕</button></div>
      <img class="ft-cam-big" src="${esc(c.img)}${c.img.includes('?') ? '&' : '?'}t=${Date.now()}" alt=""/>
      <p class="small muted">${esc(c.src)}${c.route ? ` · ${esc(c.route)}` : ''} · snapshot refreshes every few minutes${c.video ? ` · <a href="${esc(c.video)}" target="_blank" rel="noopener">live video ↗</a>` : ''}</p>`);
    m.querySelector('#fc-x').onclick = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  }));
}
const ROUTE_COL = ['#2563eb', '#8b5cf6', '#0d9488'];
// Highways a route uses that the fastest route doesn't ("via US-50").
function routeVia(r, all) {
  const roads = r.roads || [];
  if (r === all[0]) return roads.slice(0, 3).join(' → ');
  const diff = roads.filter((x) => !(all[0].roads || []).includes(x));
  return (diff.length ? diff : roads).slice(0, 3).join(' → ');
}
let ftMap = null;
async function drawRouteMap(routes, sel, from, to) {
  const el = document.getElementById('ft-map'); if (!el) return;
  try { await loadMapLibre(); } catch { el.innerHTML = '<p class="pad small muted">Map unavailable.</p>'; return; }
  if (!document.body.contains(el)) return;
  const feats = routes.map((r, k) => lineF(r.coords, { k, sel: k === sel }));
  const draw = () => {
    ftMap.getSource('routes').setData(fc(feats));
    const all = routes[sel].coords.map(([la, lo]) => [lo, la]);
    ftMap.fitBounds(all.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(all[0], all[0])), { padding: 28, duration: 600 });
  };
  if (ftMap && ftMap.getContainer() === el && ftMap.getSource('routes')) return draw();
  try { ftMap?.remove(); } catch {}
  try {
    ftMap = new maplibregl.Map({ container: el, style: roadStyle(), center: [to[1], to[0]], zoom: 7, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
  } catch { el.innerHTML = '<p class="pad small muted">Map needs WebGL.</p>'; return; }
  ftMap.once('style.load', () => {
    ftMap.addSource('routes', { type: 'geojson', data: fc([]) });
    ftMap.addLayer({ id: 'r-alt', type: 'line', source: 'routes', filter: ['!', ['get', 'sel']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'k'], 1, ROUTE_COL[1], 2, ROUTE_COL[2], ROUTE_COL[0]], 'line-width': 4, 'line-opacity': 0.55 } });
    ftMap.addLayer({ id: 'r-casing', type: 'line', source: 'routes', filter: ['get', 'sel'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
    ftMap.addLayer({ id: 'r-sel', type: 'line', source: 'routes', filter: ['get', 'sel'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'k'], 1, ROUTE_COL[1], 2, ROUTE_COL[2], ROUTE_COL[0]], 'line-width': 6 } });
    const pin = (ll, cls) => { const d = document.createElement('div'); d.className = cls; return new maplibregl.Marker({ element: d }).setLngLat([ll[1], ll[0]]).addTo(ftMap); };
    pin(from, 'ft-pin from'); pin(to, 'ft-pin to');
    draw();
  });
}
function roadStyle() {
  return {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, shade: DEM },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#eef0ec' } },
      { id: 'shade', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#7d8a99', 'hillshade-highlight-color': '#ffffff' } },
      { id: 'forest', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#cfe3c8', 'fill-opacity': 0.7 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#a9cdeb' } },
      { id: 'minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]], paint: { 'line-color': '#ffffff', 'line-width': 1.2 } },
      { id: 'major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': '#f3c77a', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 2.5] } },
      { id: 'places', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]], layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#3f4650', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } },
      { id: 'shields', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 6, filter: ['has', 'ref'], layout: { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'symbol-spacing': 300 }, paint: { 'text-color': '#7a4b00', 'text-halo-color': '#fff7e6', 'text-halo-width': 2 } },
    ],
  };
}
const wmoIcon = (c) => (c >= 95 ? '⛈️' : c >= 85 || (c >= 71 && c <= 77) ? '🌨️' : c >= 61 || (c >= 51 && c <= 57) || (c >= 80 && c <= 82) ? '🌧️' : c >= 45 && c <= 48 ? '🌫️' : c >= 2 ? '☁️' : '☀️');
const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Sr|Us|I|Ca|Hwy|Mp)\b/g, (x) => x.toUpperCase());

// ---------- in-app resort webcams (tap to play the resort's own live player) ----------
function openCam(name, embed, r) {
  const el = modal(`
    <div class="cam-h"><b>${esc(name)}</b><button class="circ sm" id="cam-x" aria-label="Close">✕</button></div>
    <div class="cam-frame"><iframe src="${esc(embed)}" title="${esc(name)} webcam" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="eager" referrerpolicy="no-referrer-when-downgrade"></iframe></div>
    <p class="small muted" style="margin:8px 0 0">Live from ${esc(r.name)}. Not loading? <a href="${esc(embed)}" target="_blank" rel="noopener">Open the cam ↗</a> or <a href="${esc(camsLink(r))}" target="_blank" rel="noopener">the resort's cam page ↗</a></p>`);
  el.classList.add('cam-modal');
  const close = () => el.remove();
  el.querySelector('#cam-x').onclick = close;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}

// ---------- first-launch donation note ----------
function maybeShowDonate(after) {
  if (localStorage.getItem(DONATE_KEY)) { after?.(); return; }
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="dn-h">
      <img src="/icons/icon-192.png" alt="" width="56" height="56" style="border-radius:12px" />
      <h2 id="dn-h">Welcome to White Powder</h2>
      <p>White Powder is built on donations only, and we'd love your support.</p>
      <p><b>$5 goes a long way!</b></p>
      <a class="btn primary block" id="dn-go" href="${VENMO_URL}" target="_blank" rel="noopener">Donate on Venmo · @adamjames95</a>
      <button class="btn block" id="dn-later">Maybe later</button>
    </div>`;
  document.body.appendChild(el);
  const close = () => { try { localStorage.setItem(DONATE_KEY, '1'); } catch {} el.remove(); if (after) setTimeout(after, 250); };
  el.querySelector('#dn-go').addEventListener('click', close);
  el.querySelector('#dn-later').addEventListener('click', close);
}

// ---------- settings / push ----------
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function currentSub() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Keep the server's alert list in step with this device's mountains (if alerts are on). */
async function syncSub() {
  try { const sub = await currentSub(); if (sub) await postSub({ action: 'save', subscription: sub.toJSON(), prefs: getPrefs() }); } catch {}
}

function serverPrefs(p) {
  return { ...p, resorts: p.resorts.map(byId).filter(Boolean).map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, summitFt: r.summitFt })) };
}

async function postSub(body) {
  if (body.prefs) body = { ...body, prefs: serverPrefs(body.prefs) };
  const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()) || r.status);
  return r.json();
}

async function renderSettings() {
  const prefs = getPrefs();
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const pushOK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const sub = pushOK ? await currentSub().catch(() => null) : null;

  const theme = localStorage.getItem('wp:theme:v1') || 'dark';
  app.innerHTML = `
    <a class="back" href="#/">‹ Back</a>
    <h1 class="title">Settings</h1>
    <section class="section stack">
      <h3>Your rider</h3>
      <div class="card pad set-rider">${myAv() ? riderCard(myAv(), aiMe().name) : '<p class="small muted" style="margin:0">No rider yet. Build one and your ski squad will see it on the map.</p>'}
      <button class="btn" id="set-av">${myAv() ? 'Edit rider' : 'Build your rider'}</button></div>
    </section>
    <section class="section stack">
      <h3>Appearance</h3>
      <div class="seg-ctl theme-ctl" role="radiogroup" aria-label="Appearance">
        ${[['system', 'Match iPhone'], ['light', 'Light'], ['dark', 'Dark'], ['time', 'Time of day']].map(([k, v]) => `<button data-theme-opt="${k}" class="${theme === k ? 'on' : ''}" role="radio" aria-checked="${theme === k}">${v}</button>`).join('')}
      </div>
      <p class="small muted">${theme === 'system' ? 'Follows your iPhone\'s Light/Dark setting.' : theme === 'time' ? 'Light from 7 AM to 6 PM, dark the rest of the time.' : ''}</p>
    </section>
    <section class="section stack">
      <h3>Your vehicle</h3>
      ${vehicleEditor(getVehicle() || { ...VEHICLE_DEFAULT })}
      <p class="small muted">First Tracks uses this for chain-control and tire advice.</p>
    </section>
    <section class="section stack">
      <h3>Powder alerts · when to alert</h3>
      <label>Notify me when a resort's summit forecast hits
        <select id="thr">${[3, 4, 6, 8, 10, 12, 18, 24].map((v) => `<option value="${v}" ${v === prefs.threshold ? 'selected' : ''}>${v}"</option>`).join('')}</select>
        in a single day, within the next
        <select id="win">${[1, 2, 3, 5, 7].map((v) => `<option value="${v}" ${v === prefs.withinDays ? 'selected' : ''}>${v} day${v > 1 ? 's' : ''}</option>`).join('')}</select>
      </label>
      <div>${RESORTS.map((r) => `<label class="opt"><input type="checkbox" value="${r.id}" ${prefs.resorts.includes(r.id) ? 'checked' : ''}/> ${esc(r.name)}</label>`).join('')}</div>
      <p class="small muted">Each storm alerts once per resort per day. Checks run twice daily (about 6 am and 6 pm Pacific).</p>
    </section>
    <section class="section stack">
      <h3>Webcams</h3>
      <label class="opt"><input type="checkbox" id="cam-auto" ${camAutoplay() ? 'checked' : ''}/> Auto-play the first cam when I open a mountain (on by default)</label>
      <p class="small muted">Off by default: live video uses more data and can slow things down. When off, tap any cam preview to play it.</p>
    </section>
    <section class="section stack" id="push-box">
      ${!pushOK ? `<div class="note">${standalone ? 'This device doesn\'t support web push.' : 'On iPhone: tap Share → <b>Add to Home Screen</b>, then open White Powder from your home screen to turn on alerts.'}</div>` : ''}
      ${pushOK && !sub ? `<button class="btn primary" id="enable">Turn on alerts on this device</button>` : ''}
      ${pushOK && sub ? `<div class="note">✓ Alerts are on for this device.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="test">Send test alert</button><button class="btn" id="disable">Turn off</button></div>` : ''}
      <div id="push-msg" class="small"></div>
    </section>`;

  const msg = (t, err) => { const m = document.getElementById('push-msg'); m.textContent = t; m.className = `small ${err ? 'err' : 'secondary'}`; };
  const readPrefs = () => ({
    threshold: +document.getElementById('thr').value,
    withinDays: +document.getElementById('win').value,
    resorts: [...app.querySelectorAll('input[type=checkbox][value]:not(#cam-auto):checked')].map((c) => c.value),
  });
  const save = async () => {
    const p = readPrefs(); setPrefs(p);
    const s = pushOK ? await currentSub().catch(() => null) : null;
    if (s) { try { await postSub({ action: 'save', subscription: s.toJSON(), prefs: p }); msg('Saved.'); } catch (e) { msg(`Couldn't save to server: ${e.message}`, true); } }
  };
  app.querySelectorAll('select, input[type=checkbox]:not(#cam-auto)').forEach((el) => el.addEventListener('change', save));
  wireVehicle(app, () => { if (!localStorage.getItem(VEH_KEY)) setVehicle({ ...VEHICLE_DEFAULT }); });
  app.querySelectorAll('[data-theme-opt]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('wp:theme:v1', b.dataset.themeOpt); } catch {}
    window.wpTheme?.(); renderSettings();
  }));
  document.getElementById('set-av')?.addEventListener('click', () => openAvatarBuilder(() => renderSettings()));
  document.getElementById('cam-auto')?.addEventListener('change', (e) => { try { localStorage.setItem(CAM_AUTO_KEY, e.target.checked ? '1' : '0'); } catch {} msg(e.target.checked ? 'Cams will auto-play.' : 'Cams will wait for a tap.'); });

  document.getElementById('enable')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications were not allowed.');
      const { publicKey } = await getJSON('/api/vapid');
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      await postSub({ action: 'save', subscription: s.toJSON(), prefs: readPrefs() });
      renderSettings();
    } catch (err) { msg(err.message || String(err), true); e.target.disabled = false; }
  });
  document.getElementById('test')?.addEventListener('click', async () => {
    try { await postSub({ action: 'test', subscription: (await currentSub()).toJSON() }); msg('Test sent — check your notifications.'); }
    catch (e) { msg(e.message, true); }
  });
  document.getElementById('disable')?.addEventListener('click', async () => {
    const s = await currentSub();
    if (s) { await postSub({ action: 'remove', subscription: s.toJSON() }).catch(() => {}); await s.unsubscribe(); }
    renderSettings();
  });
}

// ---------- snow strips: one shared horizontal position for every row ----------
// The strips don't scroll natively: one gesture drives a single offset that every row renders,
// so all rows move, coast and bounce together frame-for-frame.
const K = 0.00016, C = 2 * Math.sqrt(K); // soft, critically damped spring (per ms) — iOS-like ~0.4 s settle
const allStrips = () => document.querySelectorAll('[data-strip][data-home]');
function stripGeom() {
  const el = document.querySelector('[data-strip][data-home]');
  const s = el?.firstElementChild;
  return el && s ? { el, s, W: el.clientWidth, max: Math.max(0, s.offsetWidth - el.clientWidth) } : null;
}
const rubber = (d, W) => (1 - 1 / ((d * 0.55) / W + 1)) * W;
function shownX() {
  const g = stripGeom();
  if (!g || !SX.raw) return SX.x;
  if (SX.x < 0) return -rubber(-SX.x, g.W);
  if (SX.x > g.max) return g.max + rubber(SX.x - g.max, g.W);
  return SX.x;
}
function applyX() {
  const d = shownX();
  for (const el of allStrips()) { const s = el.firstElementChild; if (s) s.style.transform = `translate3d(${-d}px,0,0)`; }
}
// Where to rest after a swipe:
//  · back into history: return to "Last 24h" only if less than half a Days 1-5 block's width of history is showing
//  · toward the forecast: return if more than half of the "Last 24h" box is still on screen
function homeTarget() {
  const g = stripGeom();
  const box = g?.s.querySelector('.l24');
  if (!box) return null;
  const home = Number(g.el.dataset.home);
  if (Math.abs(SX.x - home) <= 1) return null;
  if (SX.x < home) {
    const block = (g.s.querySelector('.seg.fc .grp')?.offsetWidth) || 125;
    return home - SX.x < block / 2 ? home : null;
  }
  const left = box.getBoundingClientRect().left - g.s.getBoundingClientRect().left, w = box.offsetWidth || 1;
  const seen = Math.max(0, Math.min(SX.x + g.W, left + w) - Math.max(SX.x, left)) / w;
  return seen > 0.5 ? home : null;
}
function animate() {
  cancelAnimationFrame(SX.anim);
  let last = performance.now();
  const step = (t) => {
    const dt = Math.min(32, t - last); last = t;
    const g = stripGeom(); if (!g) { SX.anim = 0; return; }
    if (SX.mode === 'free') {
      SX.v *= Math.pow(0.996, dt); SX.x += SX.v * dt;
      if (SX.x < 0 || SX.x > g.max) { SX.mode = 'spring'; SX.target = SX.x < 0 ? 0 : g.max; SX.v *= 0.45; } // overshoot → soft bounce back
      else if (Math.abs(SX.v) < 0.03) {
        const h = homeTarget();
        if (h == null) { SX.v = 0; applyX(); SX.anim = 0; return; }
        SX.mode = 'spring'; SX.target = h; SX.v = 0;
      }
    }
    if (SX.mode === 'spring') {
      SX.v += (-K * (SX.x - SX.target) - C * SX.v) * dt; SX.x += SX.v * dt;
      if (Math.abs(SX.x - SX.target) < 0.4 && Math.abs(SX.v) < 0.02) {
        SX.x = SX.target; SX.v = 0; applyX();
        const h = homeTarget();
        if (h != null) { SX.target = h; } else { SX.anim = 0; return; }
      }
    }
    applyX();
    SX.anim = requestAnimationFrame(step);
  };
  SX.anim = requestAnimationFrame(step);
}
let gest = null;
const swallowClick = () => {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, true), 350);
};
document.addEventListener('touchstart', (e) => {
  const el = e.target instanceof Element && e.target.closest('[data-strip]');
  if (!el || e.touches.length > 1) { gest = null; return; }
  if (SX.anim) { cancelAnimationFrame(SX.anim); SX.anim = 0; }
  SX.x = shownX(); SX.raw = false;
  const t = e.touches[0];
  gest = { x0: t.clientX, y0: t.clientY, start: SX.x, axis: null, pts: [[performance.now(), t.clientX]] };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!gest) return;
  const t = e.touches[0], dx = t.clientX - gest.x0, dy = t.clientY - gest.y0;
  if (!gest.axis) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    gest.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  }
  if (gest.axis !== 'x' || sortActive) { gest = null; return; }
  e.preventDefault();
  SX.raw = true; SX.x = gest.start - dx;
  gest.pts.push([performance.now(), t.clientX]); if (gest.pts.length > 6) gest.pts.shift();
  applyX();
}, { passive: false });
const endGesture = () => {
  if (!gest) return;
  const g0 = gest; gest = null;
  if (g0.axis !== 'x') return;
  swallowClick();
  const [ta, xa] = g0.pts[0], [tb, xb] = g0.pts[g0.pts.length - 1];
  const v = tb - ta > 0 && performance.now() - tb < 80 ? -(xb - xa) / (tb - ta) : 0;
  const g = stripGeom();
  SX.x = shownX(); SX.raw = false;
  if (g && (SX.x < 0 || SX.x > g.max)) { SX.mode = 'spring'; SX.target = SX.x < 0 ? 0 : g.max; SX.v = 0; }
  else { SX.mode = 'free'; SX.v = Math.max(-4, Math.min(4, v)); }
  animate();
};
document.addEventListener('touchend', endGesture, { passive: true });
document.addEventListener('touchcancel', endGesture, { passive: true });
// trackpad / mouse wheel
let wheelTimer = 0;
document.addEventListener('wheel', (e) => {
  const el = e.target instanceof Element && e.target.closest('[data-strip]');
  if (!el || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  if (SX.anim) { cancelAnimationFrame(SX.anim); SX.anim = 0; }
  const g = stripGeom(); if (!g) return;
  SX.raw = false; SX.x = Math.max(0, Math.min(g.max, SX.x + e.deltaX)); applyX();
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { SX.mode = 'free'; SX.v = 0; animate(); }, 160);
}, { passive: false });
window.addEventListener('resize', applyX);

// ---------- swipe a home card left to reveal its trash can ----------
(() => {
  const OPEN = 92;
  let g = null, openEl = null;
  const setX = (w, x, anim) => { const c = w.querySelector('.card'); c.style.transition = anim ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none'; c.style.transform = x ? `translateX(${x}px)` : ''; w.classList.toggle('open', x < -10); };
  const close = () => { if (openEl) { setX(openEl, 0, true); openEl = null; } };
  document.addEventListener('touchstart', (e) => {
    const w = e.target instanceof Element && e.target.closest('.swc');
    if (openEl && (!w || w !== openEl || !e.target.closest('.sw-del'))) { if (!e.target.closest?.('.sw-del')) { close(); if (w) { g = null; return; } } }
    if (!w || !w.querySelector('.sw-del') || e.target.closest('[data-strip], .star, .sw-del') || sortActive) { g = null; return; }
    const t = e.touches[0];
    g = { w, x0: t.clientX, y0: t.clientY, axis: null, base: w === openEl ? -OPEN : 0, x: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.axis) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'; }
    if (g.axis !== 'x' || sortActive) { g = null; return; }
    e.preventDefault();
    let x = g.base + dx;
    if (x > 0) x = x * 0.2; // resist dragging right
    if (x < -OPEN) x = -OPEN + (x + OPEN) * 0.35; // and past the button
    g.x = x; setX(g.w, x, false);
  }, { passive: false });
  const end = () => {
    if (!g) return;
    const { w, axis, x } = g; g = null;
    if (axis !== 'x') return;
    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, true), 350);
    if (x < -OPEN / 2) { if (openEl && openEl !== w) close(); setX(w, -OPEN, true); openEl = w; }
    else { setX(w, 0, true); if (openEl === w) openEl = null; }
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
  window.addEventListener('hashchange', () => { openEl = null; });
})();

// ---------- pull down to refresh (iOS home-screen apps have no built-in one) ----------
async function hardRefresh() {
  const before = state.fetchedAt;
  statusCache.clear(); snotelCache.clear(); obsPending.clear(); camsCache.clear(); modelDepth.clear(); loadQ.fails.clear();
  // never leave the spinner hanging: give the forecast service ~15 s, keep the saved forecast if it's slow
  await Promise.race([refresh(true), sleep(15000)]);
  if (location.hash.startsWith('#/resort/')) safeRender();
  const ok = state.fetchedAt !== before && !state.error;
  if (!ok) state.error = null;
  if (!ok) miniToast('Forecast service is slow right now — showing your saved forecast. Lift status refreshed.');
  if (!ok) safeRender();
}
function miniToast(text) {
  document.querySelector('.mini-toast')?.remove();
  const t = document.createElement('div'); t.className = 'mini-toast'; t.textContent = text; document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in')); setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2600);
}
(() => {
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.innerHTML = `<svg class="ptr-spin" viewBox="0 0 40 40" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<rect class="sp" style="--i:${i}" x="18.5" y="4" width="3" height="10" rx="1.5" transform="rotate(${i * 30} 20 20)"/>`).join('')}</svg>`;
  let wasReady = false;
  document.body.appendChild(ind);
  const TRIGGER = 70;
  let y0 = null, x0 = 0, pull = 0, busy = false;
  const blocked = (t) => sortActive || busy || document.querySelector('.tour, .modal') || (t instanceof Element && t.closest('.modal, .cam-frame, .leaflet-container, .maplibregl-canvas, .av3d'));
  const appEl = document.getElementById('app');
  const GAP = 56; // the spinner's own slot above the content while loading
  const slide = (px, anim) => {
    appEl.style.transition = anim ? 'transform .35s cubic-bezier(.2,.8,.2,1)' : 'none';
    appEl.style.transform = px ? `translateY(${px}px)` : '';
  };
  const show = (d) => {
    ind.style.setProperty('--pull', `${Math.min(d, TRIGGER * 1.4)}px`);
    if (!busy) slide(Math.min(d, TRIGGER * 1.6), false);
    const ready = d >= TRIGGER;
    if (ready && !wasReady && !busy) haptic(8);
    wasReady = ready;
    ind.classList.toggle('ready', ready);
    // spokes appear one by one as you pull, like iOS
    const n = Math.round(Math.min(1, d / TRIGGER) * 12);
    ind.querySelectorAll('.sp').forEach((el, i) => el.classList.toggle('on', i < n || busy));
    ind.style.opacity = String(Math.min(1, d / (TRIGGER * 0.5)));
  };
  document.addEventListener('touchstart', (e) => {
    y0 = window.scrollY <= 0 && e.touches.length === 1 && !blocked(e.target) ? e.touches[0].clientY : null; x0 = e.touches[0]?.clientX || 0; pull = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    if (window.scrollY > 0) { y0 = null; show(0); return; }
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (pull < 8 && Math.abs(dx) > Math.abs(dy)) { y0 = null; show(0); return; } // sideways swipe on a snow strip: not a pull
    pull = Math.max(0, dy * 0.5);
    show(pull);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (pull < TRIGGER) { slide(0, true); ind.style.opacity = '0'; show(0); return; }
    haptic(12);
    busy = true; ind.classList.add('spin', 'held'); ind.style.opacity = '1';
    slide(GAP, true);
    const t0 = Date.now();
    try { await hardRefresh(); } finally {
      await sleep(Math.max(0, 900 - (Date.now() - t0))); // let the spinner sit for a beat
      ind.style.opacity = '0';
      slide(0, true);
      setTimeout(() => { busy = false; ind.classList.remove('spin', 'ready', 'held'); show(0); }, 350);
    }
  }, { passive: true });
})();

// Keep a spacer the exact height of the fixed top bar (it changes with the safe area / rotation).
(() => {
  const tb = document.querySelector('.topbar'); if (!tb) return;
  const set = () => document.documentElement.style.setProperty('--tb-h', `${tb.offsetHeight}px`);
  set(); addEventListener('resize', set); addEventListener('orientationchange', set);
  try { new ResizeObserver(set).observe(tb); } catch {}
})();

// ---------- bottom tabs: Forecast · Powder AI ----------
(() => {
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.innerHTML = `<a href="#/" data-tab="fc">Forecast</a><a href="#/drive" data-tab="drive">First Tracks</a><a href="#/ai" data-tab="ai">Powder AI</a>`;
  document.body.appendChild(nav);
  document.body.classList.add('has-tabs');
  const sync = () => {
    const ai = location.hash.startsWith('#/ai'), dr = location.hash.startsWith('#/drive');
    nav.querySelector('[data-tab=fc]').classList.toggle('on', !ai && !dr);
    nav.querySelector('[data-tab=drive]').classList.toggle('on', dr);
    nav.querySelector('[data-tab=ai]').classList.toggle('on', ai);
  };
  addEventListener('hashchange', sync); sync(); setInterval(sync, 5000);
})();
// Resume tracking after a reload if a ski day is in progress.
if (aiDay() && !location.hash.startsWith('#/ai')) { try { startTracking(aiDay()); AI.dayId = aiDay().id; } catch {} }

// ---------- theme follows iOS / the clock while the app is open ----------
window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => window.wpTheme?.());
setInterval(() => window.wpTheme?.(), 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') window.wpTheme?.(); });

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); safeRender(); });
refreshBtn?.addEventListener('click', () => hardRefresh());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
loadCached();
safeRender();
refresh();
setTimeout(() => (localStorage.getItem(ONBOARD_KEY) ? maybeShowDonate() : maybeShowDonate(() => startOnboarding())), 700);
setTimeout(() => { if (!document.querySelector('.modal')) holidayPromo(); }, 2600);
holidayDecor();
