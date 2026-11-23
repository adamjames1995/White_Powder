import { CATALOG, logoUrl } from '/lib/resorts.js';
import { loadResorts, sumDays, MODELS } from '/lib/snow.js';
import { getMountains, saveMountains, getFavorites, saveFavorites, uniqueId, measureElevations, searchPlaces, nearestSnotel } from '/lib/store.js';

let RESORTS = getMountains();
let FAVS = getFavorites();
const byId = (id) => RESORTS.find((r) => r.id === id);
const VIEW_KEY = 'wp:view:v1';
const DONATE_KEY = 'wp:donate-seen:v1';
const VENMO_URL = 'https://venmo.com/u/adamjames95';

window.__wpBooted = true;
const stage = (s) => window.__wpStage?.(s);

const app = document.getElementById('app');
const refreshBtn = document.getElementById('refresh');
const CACHE_KEY = 'wp:forecast:v3';
const PREFS_KEY = 'snowline:prefs:v1';
const FRESH_MS = 30 * 60 * 1000;

let state = { data: null, fetchedAt: 0, error: null };
const snotelCache = new Map();
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
  refreshBtn.classList.add('spin');
  try {
    stage('requesting forecast');
    const data = await loadAll(RESORTS);
    stage('drawing');
    state = { data, fetchedAt: Date.now(), error: null };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, fetchedAt: state.fetchedAt })); } catch {}
  } catch (e) {
    stage('failed');
    state.error = e.message || String(e);
  } finally {
    refreshBtn.classList.remove('spin');
    safeRender();
  }
}

/** Fetch forecasts in chunks of 8 mountains (16 points) so each request stays light. */
async function loadAll(list) {
  const chunks = [];
  for (let i = 0; i < list.length; i += 8) chunks.push(list.slice(i, i + 8));
  const results = await Promise.allSettled(chunks.map((c) => loadResorts(c, { onStage: stage })));
  const data = {};
  let err = null;
  results.forEach((r) => { if (r.status === 'fulfilled') Object.assign(data, r.value); else err = r.reason; });
  if (!Object.keys(data).length && err) throw err;
  return data;
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
  const [, view, id] = (location.hash || '#/').split('/');
  document.body.classList.toggle('detail', view === 'resort');
  if (view === 'resort' && byId(id)) return renderResort(byId(id));
  if (view === 'settings') return renderSettings();
  if (view === 'manage') return renderManage();
  renderHome();
}

// Shared bar scale across all resorts (history + 15-day forecast) so heights compare honestly.
function sharedScale() {
  return Math.max(12, ...shownList().list.concat(location.hash.startsWith('#/resort/') ? [byId(location.hash.split('/')[2])].filter(Boolean) : []).flatMap((r) => {
    const s = state.data?.[r.id]?.summit;
    return s ? [...historyDays(r, s).map((d) => d.snow), ...s.days.slice(0, 15).map((d) => d.snow)] : [];
  }));
}

/** Past days: SNOTEL-reported daily new snow when available, otherwise modeled. */
function historyDays(r, s) {
  const obs = snotelCache.get(r.id);
  const rep = new Map((obs && !obs.error && obs.daily ? obs.daily : []).map((d) => [d.date, d.newIn]));
  return (s.history || []).slice(-7).map((d) => {
    const v = rep.get(d.date);
    return v != null ? { date: d.date, snow: v, src: 'rep' } : { date: d.date, snow: d.snow, mixed: d.mixed, src: 'est' };
  });
}

function shownList() {
  const view = localStorage.getItem(VIEW_KEY) || 'fav';
  const favs = RESORTS.filter((r) => FAVS.has(r.id));
  return { view, list: view === 'fav' ? favs : RESORTS, favCount: favs.length };
}

function renderHome() {
  if (!state.data) {
    app.innerHTML = state.error
      ? `<div class="pad"><p class="err">Couldn't load the forecast.</p><p class="small muted">${esc(state.error)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`
      : `<p class="pad muted">Loading forecast…</p>`;
    return;
  }
  const prefs = getPrefs();
  const { view, list, favCount } = shownList();
  const cards = list.map((r) => {
    const s = state.data[r.id]?.summit;
    const star = `<button class="star ${FAVS.has(r.id) ? 'on' : ''}" data-star="${r.id}" aria-label="${FAVS.has(r.id) ? 'Remove from' : 'Add to'} favorites">${FAVS.has(r.id) ? '★' : '☆'}</button>`;
    if (!s) {
      return `<div class="card rc"><div class="rc-head">${badge(r)}<div class="rc-title"><h2>${esc(r.name)}</h2><div class="sub">Loading forecast…</div></div>${star}</div></div>`;
    }
    const pd = prefs.resorts.includes(r.id) ? powderDay(s.days, prefs) : null;
    return `
      <a class="card rc" href="#/resort/${r.id}">
        <div class="rc-head">
          ${badge(r)}
          <div class="rc-title">
            <h2>${esc(r.name)}</h2>
            <div class="sub">${r.summitFt.toLocaleString()} ft · ${esc([r.state, r.country].filter(Boolean).join(' · '))}</div>
            ${pd ? `<span class="pow" title="Powder alert">❄ Powder alert: ${inch(pd.snow)} ${dow(pd.date)}</span>` : ''}
          </div>
          ${star}
        </div>
        <div class="scroller" data-strip="${r.id}"></div>
      </a>`;
  }).join('');
  const empty = view === 'fav' && !favCount
    ? `<div class="card pad"><p>No favorites yet.</p><p class="small muted">Tap ☆ on any mountain under <b>All</b>, or add new mountains with <b>Edit</b>.</p></div>`
    : !RESORTS.length ? `<div class="card pad"><p>No mountains yet.</p><a class="btn primary" href="#/manage">Add mountains</a></div>` : '';
  app.innerHTML = `
    <div class="homebar">
      <div class="seg-ctl" role="tablist">
        <button data-view="fav" class="${view === 'fav' ? 'on' : ''}">★ Favorites</button>
        <button data-view="all" class="${view === 'all' ? 'on' : ''}">All (${RESORTS.length})</button>
      </div>
      <a class="btn sm" href="#/manage">Edit</a>
    </div>
    <div class="updated">Updated ${ago(state.fetchedAt)} · summit forecasts · swipe left for history${state.error ? ` · <span class="err">refresh failed</span>` : ''}</div>
    ${empty}${cards}
    ${list.length ? legendKey() : ''}
    <p class="support"><a href="${VENMO_URL}" target="_blank" rel="noopener">♥ Support White Powder</a></p>`;

  app.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem(VIEW_KEY, b.dataset.view); renderHome();
  }));
  app.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    toggleFav(b.dataset.star); renderHome();
  }));
  mountStrips(false);
  list.forEach((r) => loadObs(r).then(() => mountStrips(false, r.id)));
  list.filter((r) => !state.data[r.id]).forEach((r) => loadOne(r).then(() => location.hash.length <= 2 && renderHome()));
}

function toggleFav(id) {
  FAVS.has(id) ? FAVS.delete(id) : FAVS.add(id);
  saveFavorites(FAVS);
}

function legendKey() {
  return `<div class="key"><span><i style="background:var(--hist)"></i>Reported</span><span><i style="background:var(--snow)"></i>Snow</span><span><i style="background:var(--mixed)"></i>Rain/snow mix</span></div>`;
}

function badge(r, cls = '') {
  const initials = r.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
  return `<div class="badge ${cls}" aria-hidden="true">${esc(initials)}<img src="${logoUrl(r)}" alt="" loading="lazy" onerror="this.remove()"/></div>`;
}

/** (Re)render every strip container on the page, keeping scroll position after the first mount. */
function mountStrips(labels, onlyId) {
  const scale = sharedScale();
  document.querySelectorAll('[data-strip]').forEach((el) => {
    const r = byId(el.dataset.strip);
    if (!r || (onlyId && r.id !== onlyId)) return;
    const s = state.data[r.id].summit;
    const first = !el.dataset.mounted;
    const prev = el.scrollLeft;
    el.innerHTML = snowStrip(historyDays(r, s), s.days.slice(0, 15), last24Box(r, s), scale, labels || el.dataset.labels === '1');
    const histW = el.querySelector('.seg.hist')?.offsetWidth || 0;
    el.scrollLeft = first ? Math.max(0, histW - 18) : prev; // peek a sliver of history
    el.dataset.mounted = '1';
  });
}

function obsTime(iso) {
  // SNOTEL times are local station time, e.g. "2026-11-22 07:00"
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return '';
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()} ${h % 12 || 12}:${m}${h < 12 ? 'a' : 'p'}`;
}

function last24Box(r, s) {
  const obs = snotelCache.get(r.id);
  const reported = obs && !obs.error && obs.new24In != null;
  const val = reported ? obs.new24In : s.current?.modeled24In;
  return `<div class="l24">
    <div class="l24-k">Last 24 Hours</div>
    <div class="l24-v">${inch(val)}</div>
    <div class="l24-t">${esc(reported ? obsTime(obs.time) : 'Model')}</div>
    <div class="l24-s ${reported ? 'rep' : 'est'}">${reported ? 'Reported ✓' : r.snotel && !obs ? 'Loading…' : 'Estimated ⓘ'}</div>
  </div>`;
}

const COL = 34, BAR_H = 64;
function stripCols(days, scaleMax, labels, hist) {
  return days.map((d) => {
    const h = d.snow >= 0.1 ? Math.max(4, Math.round((d.snow / scaleMax) * BAR_H)) : 0;
    const weekend = [0, 6].includes(dayDate(d.date).getDay());
    const cls = hist && d.src === 'rep' ? 'hist' : d.mixed ? 'mixed' : '';
    const tip = `${dow(d.date)} ${dom(d.date)}: ${inch(d.snow)}${hist ? (d.src === 'rep' ? ' reported' : ' estimated') : ''}`;
    const lbl = labels ? `<div class="vl">${d.snow < 0.5 ? '0' : Math.round(d.snow)}</div>` : '';
    const bar = h ? `<div class="bar ${cls}" style="height:${h}px"></div>` : `<div class="bar zero ${cls}"></div>`;
    return `<div class="col ${weekend ? 'wk' : ''}" title="${tip}"><div class="bars">${lbl}${bar}</div><div class="dl">${dow(d.date)[0]}</div><div class="dn">${dom(d.date)}</div></div>`;
  }).join('');
}

function snowStrip(history, days, l24, scaleMax, labels) {
  const grp = (label, total, n) => `<div class="grp" style="width:${n * COL}px"><div class="grp-k">${label}</div><div class="grp-line"><span>${inch(total)}</span></div></div>`;
  const histTotal = history.reduce((a, d) => a + (d.snow || 0), 0);
  const fcGroups = [0, 5, 10].filter((g) => g < days.length).map((g) => {
    const n = Math.min(5, days.length - g);
    return grp(`Next ${g + 1}-${g + n} Days`, sumDays(days, g, 5), n);
  }).join('');
  return `<div class="strip ${labels ? 'labels' : ''}">
    ${history.length ? `<div class="seg hist"><div class="grps">${grp(`Past ${history.length} Days`, histTotal, history.length).replace('class="grp-line"', 'class="grp-line h"')}</div><div class="cols">${stripCols(history, scaleMax, labels, true)}</div></div>` : ''}
    ${l24}
    <div class="seg fc"><div class="grps">${fcGroups}</div><div class="cols">${stripCols(days, scaleMax, labels, false)}</div></div>
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
        <a href="#/settings" aria-label="Powder alerts">🔔</a>
        <button id="share" aria-label="Share">⤴</button>
      </div>
    </div>
    <div class="dtitle">
      <div class="dtitle-row">${badge(r, 'sm')}<h1>${esc(r.name)}</h1></div>
      <div class="fp">Forecast Point <b>${r.summitFt.toLocaleString()} ft</b> <span class="muted">· base ${r.baseFt.toLocaleString()} ft · ${esc(r.region)}</span></div>
    </div>
    <nav class="tabs" id="tabs">
      <a href="#sec-summary" class="on">Snow Summary</a>
      <a href="#sec-weather">Weather</a>
      <a href="#sec-report">Snow Report</a>
      <a href="#sec-cams">Cams</a>
    </nav>

    <section id="sec-summary" class="dsec">
      <div class="dsec-h"><h2>Snow Summary</h2><span class="muted small">Updated ${ago(state.fetchedAt)}</span></div>
      <div class="card flat">
        <div class="scroller" data-strip="${r.id}" data-labels="1"></div>
        <details class="more" id="more-chart">
          <summary>Base vs summit · model range</summary>
          <div class="legend">
            <span><i style="background:var(--summit)"></i>Summit ${r.summitFt.toLocaleString()}'</span>
            <span><i style="background:var(--base)"></i>Base ${r.baseFt.toLocaleString()}'</span>
            <span><svg width="10" height="10" style="vertical-align:-1px;margin-right:5px"><line x1="5" x2="5" y1="0" y2="10" stroke="var(--text-secondary)" stroke-width="1.5"/></svg>Model range</span>
          </div>
          <div class="chart-wrap" id="chart"></div>
          <p class="small muted">Blend of ${esc(models)}. Tap a day for details.</p>
        </details>
      </div>
      ${legendKey()}
    </section>

    <section id="sec-cams" class="dsec">
      <div class="dsec-h"><h2>Cams</h2><a href="${esc(camsLink(r))}" target="_blank" rel="noopener">${r.camsUrl ? 'Official cams' : 'Find cams'} ↗</a></div>
      <div class="card flat"><div class="camrow" id="cams"><p class="small muted">Loading cams…</p></div></div>
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

    <section id="sec-report" class="dsec">
      <div class="dsec-h"><h2>Snow Report</h2></div>
      <div class="card flat" id="report">${reportHtml(r, s)}</div>
    </section>`;

  mountStrips(true);
  loadObs(r).then(() => {
    if (location.hash !== `#/resort/${r.id}`) return;
    mountStrips(true);
    const rep = document.getElementById('report');
    if (rep) rep.innerHTML = reportHtml(r, s);
  });
  loadCams(r);

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
    <p class="small muted" style="margin:10px 0 0">${esc(r.snotel.name)} SNOTEL · ${esc(obsTime(obs.time))}. New snow is estimated from the rise in snow depth, so it runs a little low as snow settles.</p>`;
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

async function loadCams(r) {
  const el = () => document.getElementById('cams');
  let cams = camsCache.get(r.id);
  if (!cams || Date.now() - cams.at > 8 * 60 * 1000) { // Windy free-tier image tokens expire after 10 min
    try { cams = { at: Date.now(), list: (await getJSON(`/api/webcams?lat=${r.lat}&lon=${r.lon}`)).webcams || [] }; }
    catch { cams = { at: Date.now(), list: [], error: true }; }
    camsCache.set(r.id, cams);
  }
  if (!el() || location.hash !== `#/resort/${r.id}`) return;
  const official = `<a class="cam official" href="${esc(camsLink(r))}" target="_blank" rel="noopener"><div class="ph">📷</div><span>${r.camsUrl ? `All ${esc(r.name)} cams` : `Search ${esc(r.name)} webcams`} ↗</span></a>`;
  el().innerHTML = cams.list.map((c) => `
    <a class="cam" href="${esc(c.link)}" target="_blank" rel="noopener">
      <img src="${esc(c.image)}" alt="${esc(c.title)}" loading="lazy" />
      <span>${esc(c.title)}</span>
    </a>`).join('') + official;
  if (cams.list.length) el().insertAdjacentHTML('afterend', `<p class="small muted" style="margin:6px 0 0">Webcam images via <a href="https://www.windy.com/webcams" target="_blank" rel="noopener">windy.com</a></p>`);
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

// ---------- manage mountains ----------
let searchSeq = 0;
function renderManage() {
  const inList = (c) => RESORTS.some((r) => Math.abs(r.lat - c.lat) < 0.02 && Math.abs(r.lon - c.lon) < 0.02);
  app.innerHTML = `
    <div class="mhead"><a class="back" href="#/">‹ Done</a><h1 class="title">My mountains</h1></div>
    <section class="section">
      <h3>Your list · ★ = favorite</h3>
      <div id="mylist">${RESORTS.length ? RESORTS.map((r, i) => `
        <div class="mrow" data-id="${r.id}">
          <button class="star ${FAVS.has(r.id) ? 'on' : ''}" data-act="fav" aria-label="Favorite">${FAVS.has(r.id) ? '★' : '☆'}</button>
          <div class="mname"><b>${esc(r.name)}</b><span class="small muted">${esc([r.state, r.country].filter(Boolean).join(', '))}</span><span class="small muted">${r.baseFt.toLocaleString()}–${r.summitFt.toLocaleString()} ft${r.snotel ? ' · SNOTEL' : ''}</span></div>
          <button class="ib" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="ib" data-act="down" ${i === RESORTS.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button class="ib" data-act="edit" aria-label="Edit elevations">✎</button>
          <button class="ib del" data-act="del" aria-label="Delete">🗑</button>
        </div>`).join('') : '<p class="small muted">No mountains yet — add some below.</p>'}</div>
    </section>
    <section class="section">
      <h3>Add a mountain</h3>
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
      snotel, camsUrl: null, site: c.site || null, custom: true,
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

  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Replace your list with the original 5 mountains?')) return;
    localStorage.removeItem('wp:mountains:v1'); localStorage.removeItem('wp:favorites:v1');
    RESORTS = getMountains(); FAVS = getFavorites();
    renderManage(); refresh(true);
  });
}

// ---------- first-launch donation note ----------
function maybeShowDonate() {
  if (localStorage.getItem(DONATE_KEY)) return;
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
  const close = () => { try { localStorage.setItem(DONATE_KEY, '1'); } catch {} el.remove(); };
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

  app.innerHTML = `
    <a class="back" href="#/">‹ All resorts</a>
    <h1 class="title">Powder alerts</h1>
    <section class="section stack">
      <h3>When to alert</h3>
      <label>Notify me when a resort's summit forecast hits
        <select id="thr">${[3, 4, 6, 8, 10, 12, 18, 24].map((v) => `<option value="${v}" ${v === prefs.threshold ? 'selected' : ''}>${v}"</option>`).join('')}</select>
        in a single day, within the next
        <select id="win">${[1, 2, 3, 5, 7].map((v) => `<option value="${v}" ${v === prefs.withinDays ? 'selected' : ''}>${v} day${v > 1 ? 's' : ''}</option>`).join('')}</select>
      </label>
      <div>${RESORTS.map((r) => `<label class="opt"><input type="checkbox" value="${r.id}" ${prefs.resorts.includes(r.id) ? 'checked' : ''}/> ${esc(r.name)}</label>`).join('')}</div>
      <p class="small muted">Each storm alerts once per resort per day. Checks run twice daily (about 6 am and 6 pm Pacific).</p>
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
    resorts: [...app.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value),
  });
  const save = async () => {
    const p = readPrefs(); setPrefs(p);
    const s = pushOK ? await currentSub().catch(() => null) : null;
    if (s) { try { await postSub({ action: 'save', subscription: s.toJSON(), prefs: p }); msg('Saved.'); } catch (e) { msg(`Couldn't save to server: ${e.message}`, true); } }
  };
  app.querySelectorAll('select, input[type=checkbox]').forEach((el) => el.addEventListener('change', save));

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

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); safeRender(); });
refreshBtn.addEventListener('click', () => refresh(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
loadCached();
safeRender();
refresh();
setTimeout(maybeShowDonate, 1200);
