// Detailed forecast for one point: blended hourly series, Day/Night periods, per-day hourly lists.
import { MODELS, hourlySnowIn, snowFraction, slr, localHourKey } from './snow.js';

const FT_PER_M = 3.28084;
const MM_PER_IN = 25.4;
const VARS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'precipitation_probability',
  'freezing_level_height', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'cloud_cover', 'weather_code',
];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const cToF = (c) => (isNum(c) ? (c * 9) / 5 + 32 : null);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => (isNum(deg) ? COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] : '');

export function detailUrl(r, { apiKey } = {}) {
  const host = apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
  const p = new URLSearchParams({
    latitude: String(r.lat), longitude: String(r.lon),
    elevation: String(Math.round(r.summitFt / FT_PER_M)),
    hourly: VARS.join(','),
    models: MODELS.map((m) => m.key).join(','),
    forecast_days: '16', wind_speed_unit: 'mph', timezone: 'auto',
  });
  if (apiKey) p.set('apikey', apiKey);
  return `${host}/v1/forecast?${p}`;
}

export async function fetchDetail(r) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(detailUrl(r), { signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const j = JSON.parse(body);
    return buildDetail(Array.isArray(j) ? j[0] : j, r.summitFt);
  } finally { clearTimeout(t); }
}

/** Precipitation type from liquid total and rain share. */
export function precipType(liquidIn, rainIn) {
  if (!(liquidIn >= 0.005)) return 'none';
  const r = rainIn / liquidIn;
  return r < 0.25 ? 'snow' : r > 0.75 ? 'rain' : 'mix';
}

/** Icon from precip type, cloud cover and day/night (avoids relying on one model's weather code). */
export function weatherIcon({ type, cloud, isDay, fog }) {
  if (type === 'snow') return '🌨️';
  if (type === 'mix') return '🌨️';
  if (type === 'rain') return '🌧️';
  if (fog) return '🌫️';
  if (!isNum(cloud)) return '–';
  if (cloud < 20) return isDay ? '☀️' : '🌙';
  if (cloud < 50) return isDay ? '🌤️' : '🌙';
  if (cloud < 85) return '⛅';
  return '☁️';
}

export function buildDetail(loc, elevFt, nowMs = Date.now()) {
  const h = loc.hourly;
  const times = h.time;
  const n = times.length;
  const keys = MODELS.map((m) => m.key).filter((k) => (h[`temperature_2m_${k}`] || []).some(isNum));
  const get = (v, k, i) => (h[`${v}_${k}`] || [])[i];

  const hours = [];
  for (let i = 0; i < n; i++) {
    const vals = (v) => keys.map((k) => get(v, k, i)).filter(isNum);
    const temps = keys.map((k) => get('temperature_2m', k, i));
    const snowPer = keys.map((k, j) => hourlySnowIn(get('precipitation', k, i), temps[j])).filter(isNum);
    let liq = 0, rain = 0, cnt = 0, slrSum = 0, slrW = 0;
    keys.forEach((k, j) => {
      const p = get('precipitation', k, i), t = temps[j];
      if (!isNum(p) || !isNum(t)) return;
      cnt++; liq += p; rain += p * (1 - snowFraction(t));
      const sp = p * snowFraction(t);
      if (sp > 0) { slrSum += slr(t) * sp; slrW += sp; }
    });
    if (!cnt) continue;
    const dirs = keys.map((k) => get('wind_direction_10m', k, i)).filter(isNum);
    const u = mean(dirs.map((d) => Math.sin((d * Math.PI) / 180))), w = mean(dirs.map((d) => Math.cos((d * Math.PI) / 180)));
    const pops = vals('precipitation_probability');
    const fogCodes = keys.map((k) => get('weather_code', k, i)).filter((c) => c === 45 || c === 48);
    hours.push({
      time: times[i],
      date: times[i].slice(0, 10),
      hour: Number(times[i].slice(11, 13)),
      tempF: cToF(mean(vals('temperature_2m'))),
      feelsF: cToF(mean(vals('apparent_temperature'))),
      rh: mean(vals('relative_humidity_2m')),
      liquidIn: liq / cnt / MM_PER_IN,
      rainIn: rain / cnt / MM_PER_IN,
      snowIn: mean(snowPer) ?? 0,
      slrW, slrSum,
      pop: pops.length ? mean(pops) : null,
      fzlFt: (() => { const f = mean(vals('freezing_level_height')); return isNum(f) ? f * FT_PER_M : null; })(),
      windMph: mean(vals('wind_speed_10m')),
      dir: dirs.length ? (Math.atan2(u, w) * 180) / Math.PI : null,
      gustMph: mean(vals('wind_gusts_10m')),
      cloud: mean(vals('cloud_cover')),
      fog: fogCodes.length > keys.length / 2,
      perModelSnow: Object.fromEntries(keys.map((k, j) => [k, hourlySnowIn(get('precipitation', k, i), temps[j])])),
      perModelLiq: Object.fromEntries(keys.map((k) => [k, get('precipitation', k, i)])),
    });
  }
  hours.forEach((x) => {
    x.type = precipType(x.liquidIn, x.rainIn);
    x.isDay = x.hour >= 6 && x.hour < 18;
    x.icon = weatherIcon({ type: x.liquidIn >= 0.005 ? x.type : 'none', cloud: x.cloud, isDay: x.isDay, fog: x.fog });
    x.snowLevelFt = isNum(x.fzlFt) ? Math.max(0, x.fzlFt - 1000) : null;
  });

  // Day (06–18) / Night (18–06) periods, starting with the one in progress now.
  const nowKey = localHourKey(loc.utc_offset_seconds || 0, nowMs);
  const periods = [];
  const byKey = new Map();
  for (const x of hours) {
    let date = x.date, part = 'Day';
    if (x.hour >= 18) part = 'Night';
    if (x.hour < 6) { part = 'Night'; date = prevDate(x.date); }
    const k = `${date}|${part}`;
    if (!byKey.has(k)) { const p = { date, part, hours: [] }; byKey.set(k, p); periods.push(p); }
    byKey.get(k).hours.push(x);
  }
  const out = periods
    .filter((p) => p.hours[p.hours.length - 1].time.slice(0, 13) >= nowKey && p.hours.length >= 6)
    .map((p) => summarize(p, keys));

  const hoursFromNow = hours.filter((x) => x.time.slice(0, 13) >= nowKey);
  const dates = [...new Set(hoursFromNow.map((x) => x.date))];
  return { periods: out, hours: hoursFromNow, dates, models: keys };
}

function summarize(p, keys) {
  const H = p.hours;
  const sum = (f) => H.reduce((a, x) => a + (f(x) || 0), 0);
  const liquidIn = sum((x) => x.liquidIn), rainIn = sum((x) => x.rainIn), snowIn = sum((x) => x.snowIn);
  const modelSnow = keys.map((k) => H.reduce((a, x) => a + (x.perModelSnow[k] || 0), 0));
  const slrW = sum((x) => x.slrW), slrS = sum((x) => x.slrSum);
  const pops = H.map((x) => x.pop).filter(isNum);
  // Models with data for this period, and how many of them produce ≥0.01" of precipitation.
  const liqBy = keys.map((k) => H.map((x) => x.perModelLiq[k]).filter(isNum));
  const have = liqBy.filter((a) => a.length >= H.length * 0.75);
  const modelsWet = have.filter((a) => a.reduce((x, y) => x + y, 0) >= 0.254).length;
  const validSnow = keys.map((k, j) => (liqBy[j].length >= H.length * 0.75 ? modelSnow[j] : null)).filter(isNum);
  const temps = H.map((x) => x.tempF).filter(isNum), feels = H.map((x) => x.feelsF).filter(isNum);
  const isDay = p.part === 'Day';
  const dirs = H.map((x) => x.dir).filter(isNum);
  const u = mean(dirs.map((d) => Math.sin((d * Math.PI) / 180))), w = mean(dirs.map((d) => Math.cos((d * Math.PI) / 180)));
  const levels = H.map((x) => x.snowLevelFt).filter(isNum);
  const type = precipType(liquidIn, rainIn);
  const cloud = mean(H.map((x) => x.cloud).filter(isNum));
  // Chance of precip: model-reported probability when available, else share of models producing ≥0.01".
  const agree = have.length ? Math.round((modelsWet / have.length) * 100) : null;
  return {
    date: p.date,
    part: p.part,
    snowIn,
    snowMin: validSnow.length ? Math.min(...validSnow) : snowIn,
    snowMax: validSnow.length ? Math.max(...validSnow) : snowIn,
    slr: slrW > 0 && snowIn >= 0.1 ? Math.round(slrS / slrW) : null,
    snowLevelFt: levels.length ? mean(levels) : null,
    pop: pops.length ? Math.max(...pops) : agree,
    popSource: pops.length ? 'model' : 'agreement',
    liquidIn,
    type,
    icon: weatherIcon({ type, cloud, isDay, fog: H.filter((x) => x.fog).length > H.length / 2 }),
    tempF: temps.length ? (isDay ? Math.max(...temps) : Math.min(...temps)) : null,
    feelsF: feels.length ? (isDay ? Math.max(...feels) : Math.min(...feels)) : null,
    rh: mean(H.map((x) => x.rh).filter(isNum)),
    windMph: mean(H.map((x) => x.windMph).filter(isNum)),
    dir: dirs.length ? (Math.atan2(u, w) * 180) / Math.PI : null,
    gustMph: Math.max(...H.map((x) => x.gustMph).filter(isNum), 0) || null,
    cloud,
    nModels: have.length,
  };
}

function prevDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
