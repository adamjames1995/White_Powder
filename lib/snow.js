// Forecast engine shared by the browser app and the alert job.
// Pulls GFS (HRRR-blended in the US), ECMWF IFS 0.25° and Canadian GEM from Open-Meteo,
// downscales temperature to base & summit elevation, and turns precipitation into
// snowfall with a temperature-based rain/snow split and snow-to-liquid ratio (SLR).

export const MODELS = [
  { key: 'gfs_seamless', label: 'GFS' },
  { key: 'ecmwf_ifs025', label: 'ECMWF' },
  { key: 'gem_seamless', label: 'GEM' },
];

const FT_PER_M = 3.28084;
const HOURLY = ['temperature_2m', 'precipitation', 'freezing_level_height', 'wind_speed_10m', 'wind_gusts_10m'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Fraction of precipitation falling as snow, from 2 m temperature (°C). 50% at +1 °C. */
export function snowFraction(tC) {
  if (tC <= 0) return 1;
  if (tC >= 2) return 0;
  return (2 - tC) / 2;
}

/** Kuchera-style snow-to-liquid ratio from temperature (°C), clamped 5–25. */
export function slr(tC) {
  const tK = tC + 273.15;
  const r = tK <= 271.16 ? 12 + (271.16 - tK) : 12 + 2 * (271.16 - tK);
  return clamp(r, 5, 25);
}

/** Snowfall (inches) for one hour of precipitation (mm) at temperature (°C). */
export function hourlySnowIn(precipMm, tC) {
  if (!isNum(precipMm) || !isNum(tC)) return null;
  if (precipMm <= 0) return 0;
  return (precipMm * snowFraction(tC) * slr(tC)) / 25.4;
}

/** Build the Open-Meteo URL for a list of points {lat, lon, elevFt}. */
export function forecastUrl(points, { pastDays = 7, forecastDays = 16, apiKey, models = MODELS.map((m) => m.key) } = {}) {
  const host = apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
  const p = new URLSearchParams({
    latitude: points.map((x) => x.lat).join(','),
    longitude: points.map((x) => x.lon).join(','),
    elevation: points.map((x) => Math.round(x.elevFt / FT_PER_M)).join(','),
    hourly: HOURLY.join(','),
    models: models.join(','),
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    wind_speed_unit: 'mph',
    timezone: 'auto',
  });
  if (apiKey) p.set('apikey', apiKey);
  return `${host}/v1/forecast?${p}`;
}

/** Base + summit points for each resort, in a stable order: [r0 base, r0 summit, r1 base, ...]. */
/** Mid-mountain: halfway between base and summit. */
export const midFt = (r) => Math.round((r.baseFt + r.summitFt) / 2);

export function resortPoints(resorts) {
  return resorts.flatMap((r) => [
    { resort: r.id, level: 'base', lat: r.lat, lon: r.lon, elevFt: r.baseFt },
    { resort: r.id, level: 'mid', lat: r.lat, lon: r.lon, elevFt: midFt(r) },
    { resort: r.id, level: 'summit', lat: r.lat, lon: r.lon, elevFt: r.summitFt },
  ]);
}

export async function fetchForecast(points, opts = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), opts.timeoutMs || 25000);
  try {
    const res = await fetch(forecastUrl(points, opts), ctrl ? { signal: ctrl.signal } : {});
    opts.onStage?.(`downloading (${res.status})`);
    const body = await res.text();
    opts.onStage?.('parsing');
    if (!res.ok) {
      let reason = body;
      try { reason = JSON.parse(body).reason || body; } catch {}
      throw new Error(`Open-Meteo ${res.status}: ${String(reason).slice(0, 200)}`);
    }
    const json = JSON.parse(body);
    return Array.isArray(json) ? json : [json];
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Forecast request timed out');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Local "now" key 'YYYY-MM-DDTHH' for a location, using its UTC offset. */
export function localHourKey(utcOffsetSeconds, nowMs = Date.now()) {
  return new Date(nowMs + utcOffsetSeconds * 1000).toISOString().slice(0, 13);
}

/**
 * Process one Open-Meteo location response for a point at elevFt.
 * Returns hourly per-model series, a daily table (blend + per-model), and current conditions.
 */
export function processPoint(loc, elevFt, nowMs = Date.now()) {
  const h = loc.hourly;
  const times = h.time;
  const n = times.length;
  const elevM = elevFt / FT_PER_M;

  const models = {};
  for (const { key } of MODELS) {
    const t = h[`temperature_2m_${key}`];
    const p = h[`precipitation_${key}`];
    if (!t || !p || !t.some(isNum)) continue;
    const snow = new Array(n);
    for (let i = 0; i < n; i++) snow[i] = hourlySnowIn(p[i], t[i]);
    models[key] = {
      temp: t,
      precip: p,
      snow,
      fzl: h[`freezing_level_height_${key}`] || [],
      wind: h[`wind_speed_10m_${key}`] || [],
      gust: h[`wind_gusts_10m_${key}`] || [],
    };
  }
  const keys = Object.keys(models);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  // Hourly blend of available models.
  const blendSnow = new Array(n);
  const blendTemp = new Array(n);
  for (let i = 0; i < n; i++) {
    blendSnow[i] = mean(keys.map((k) => models[k].snow[i]).filter(isNum));
    blendTemp[i] = mean(keys.map((k) => models[k].temp[i]).filter(isNum));
  }

  // Snow level (ft): freezing level − 1000 ft. Fallback: estimate from temp with a 6.5 °C/km lapse.
  const snowLevelFt = (i) => {
    const fz = keys.map((k) => models[k].fzl[i]).filter(isNum);
    let fzM = fz.length ? mean(fz) : null;
    if (fzM === null && isNum(blendTemp[i])) fzM = elevM + blendTemp[i] / 0.0065;
    return fzM === null ? null : Math.max(0, fzM * FT_PER_M - 1000);
  };

  // Daily aggregation by local date.
  const nowKey = localHourKey(loc.utc_offset_seconds || 0, nowMs);
  const today = nowKey.slice(0, 10);
  const byDate = new Map();
  for (let i = 0; i < n; i++) {
    const d = times[i].slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(i);
  }
  const days = [];
  const history = [];
  for (const [date, idx] of byDate) {
    const out = date < today ? history : days;
    const perModel = {};
    for (const k of keys) {
      const s = idx.map((i) => models[k].snow[i]).filter(isNum);
      perModel[k] = s.length >= idx.length * 0.75 ? s.reduce((a, b) => a + b, 0) : null;
    }
    const vals = Object.values(perModel).filter(isNum);
    if (!vals.length) continue;
    // Liquid precip and the share falling as rain (blend of models), for snow vs. mixed coloring.
    const liq = [], rain = [];
    for (const k of keys) {
      if (perModel[k] == null) continue;
      let l = 0, r = 0;
      for (const i of idx) {
        const p = models[k].precip[i], t = models[k].temp[i];
        if (!isNum(p) || !isNum(t)) continue;
        l += p; r += p * (1 - snowFraction(t));
      }
      liq.push(l / 25.4); rain.push(r / 25.4);
    }
    const liquidIn = mean(liq) ?? 0, rainIn = mean(rain) ?? 0;
    const temps = idx.map((i) => blendTemp[i]).filter(isNum);
    const gusts = idx.flatMap((i) => keys.map((k) => models[k].gust[i])).filter(isNum);
    const levels = idx.map(snowLevelFt).filter(isNum).sort((a, b) => a - b);
    out.push({
      date,
      snow: mean(vals),
      min: Math.min(...vals),
      max: Math.max(...vals),
      models: perModel,
      nModels: vals.length,
      liquidIn,
      rainIn,
      mixed: liquidIn > 0.02 && rainIn / liquidIn > 0.25,
      hiF: temps.length ? cToF(Math.max(...temps)) : null,
      loF: temps.length ? cToF(Math.min(...temps)) : null,
      gustMph: gusts.length ? Math.max(...gusts) : null,
      snowLevelFt: levels.length ? levels[Math.floor(levels.length / 2)] : null,
    });
  }

  // Current conditions + modeled recent snow.
  let cur = times.findIndex((t) => t.slice(0, 13) === nowKey);
  if (cur < 0) cur = 0;
  const pastSum = (hrs) => {
    let s = 0;
    for (let i = Math.max(0, cur - hrs + 1); i <= cur; i++) if (isNum(blendSnow[i])) s += blendSnow[i];
    return s;
  };
  const near = models.gfs_seamless ? 'gfs_seamless' : keys[0];
  const current = near
    ? {
        tempF: cToF(models[near].temp[cur]),
        windMph: models[near].wind[cur] ?? null,
        gustMph: models[near].gust[cur] ?? null,
        snowLevelFt: snowLevelFt(cur),
        modeled24In: pastSum(24),
        modeled72In: pastSum(72),
        next24In: (() => {
          let s = 0;
          for (let i = cur + 1; i <= Math.min(n - 1, cur + 24); i++) if (isNum(blendSnow[i])) s += blendSnow[i];
          return s;
        })(),
      }
    : null;

  return { days, history, current, modelsAvailable: keys };
}

export function cToF(c) {
  return isNum(c) ? (c * 9) / 5 + 32 : null;
}

/** Fetch + process all resorts. Returns { [resortId]: { base, summit } }. */
export async function loadResorts(resorts, opts = {}) {
  const points = resortPoints(resorts);
  let locs;
  try {
    locs = await fetchForecast(points, opts);
  } catch (e) {
    // Fallback: lighter request (GFS only, 3 days of history) before giving up.
    console.warn('Full forecast failed, retrying lighter request:', e);
    opts.onStage?.(`retrying lighter request (${e.message})`);
    locs = await fetchForecast(points, { ...opts, models: ['gfs_seamless'], pastDays: 3 });
  }
  const out = {};
  points.forEach((pt, i) => {
    out[pt.resort] ??= {};
    out[pt.resort][pt.level] = processPoint(locs[i], pt.elevFt, opts.nowMs);
  });
  return out;
}

export const sumDays = (days, from, count) =>
  days.slice(from, from + count).reduce((a, d) => a + (d.snow || 0), 0);
