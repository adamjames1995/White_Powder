import test from 'node:test';
import assert from 'node:assert/strict';
import { snowFraction, slr, hourlySnowIn, processPoint, forecastUrl, resortPoints, MODELS } from '../lib/snow.js';
import { RESORTS } from '../lib/resorts.js';
import { parseSnotelCsv, parseSnotelDailyCsv } from '../api/snotel.js';

test('rain/snow split', () => {
  assert.equal(snowFraction(-5), 1);
  assert.equal(snowFraction(1), 0.5);
  assert.equal(snowFraction(3), 0);
});

test('SLR increases as it gets colder, clamped', () => {
  assert.ok(slr(-10) > slr(-2));
  assert.ok(slr(0) < 12);
  assert.equal(slr(-40), 25);
  assert.equal(slr(5), 5);
});

test('1 inch of water at -6 C ≈ 15-17 inches of snow', () => {
  const s = hourlySnowIn(25.4, -6);
  assert.ok(s > 14 && s < 18, `got ${s}`);
  assert.equal(hourlySnowIn(10, 5), 0);
  assert.equal(hourlySnowIn(null, -5), null);
});

function fakeLoc({ days = 4, tempC = -4, precipPerHr = 1, offset = -28800 }) {
  const n = days * 24;
  const start = Date.UTC(2026, 10, 22, 0) ; // local midnight Nov 22 (strings are local)
  const time = Array.from({ length: n }, (_, i) => new Date(start + i * 3600e3).toISOString().slice(0, 16));
  const hourly = { time };
  MODELS.forEach(({ key }, m) => {
    hourly[`temperature_2m_${key}`] = time.map(() => tempC);
    // ECMWF wetter; GEM ends after 2 days (nulls)
    hourly[`precipitation_${key}`] = time.map((_, i) => (key === 'gem_seamless' && i >= 48 ? null : precipPerHr * (1 + m * 0.5)));
    hourly[`freezing_level_height_${key}`] = time.map(() => 1500);
    hourly[`wind_speed_10m_${key}`] = time.map(() => 20);
    hourly[`wind_gusts_10m_${key}`] = time.map(() => 40);
  });
  return { utc_offset_seconds: offset, hourly };
}

test('processPoint builds daily blend, range and current', () => {
  const nowMs = Date.UTC(2026, 10, 22, 12 + 8); // noon local PST
  const out = processPoint(fakeLoc({}), 8000, nowMs);
  assert.equal(out.days.length, 4);
  const d0 = out.days[0];
  assert.equal(d0.date, '2026-11-22');
  assert.equal(d0.nModels, 3);
  assert.ok(d0.min < d0.snow && d0.snow < d0.max);
  const d3 = out.days[3];
  assert.equal(d3.nModels, 2, 'GEM drops out after its horizon');
  assert.ok(Math.abs(out.current.tempF - 24.8) < 0.01);
  assert.ok(out.current.modeled24In > 0 && out.current.next24In > 0);
  assert.equal(Math.round(out.current.snowLevelFt), Math.round(1500 * 3.28084 - 1000));
});

test('warm day produces no snow', () => {
  const out = processPoint(fakeLoc({ tempC: 6 }), 4000, Date.UTC(2026, 10, 22, 20));
  assert.ok(out.days.every((d) => d.snow === 0));
});

test('forecast URL has 10 points for 5 resorts and right elevation in meters', () => {
  const pts = resortPoints(RESORTS);
  assert.equal(pts.length, 10);
  const u = new URL(forecastUrl(pts));
  assert.equal(u.searchParams.get('elevation').split(',').length, 10);
  assert.equal(u.searchParams.get('elevation').split(',')[1], String(Math.round(9050 / 3.28084)));
  assert.equal(u.searchParams.get('forecast_days'), '16');
});

test('SNOTEL CSV parsing estimates new snow from depth rise', () => {
  const lines = ['#comment', '#more', 'Date,Snow Depth (in),Snow Water Equivalent (in),Air Temperature Observed (degF)'];
  for (let h = 0; h < 73; h++) {
    const depth = h < 48 ? 30 : 30 + (h - 48) * 0.5; // +12" over last 24 h
    lines.push(`2026-11-${String(19 + Math.floor(h / 24)).padStart(2, '0')} ${String(h % 24).padStart(2, '0')}:00,${depth},${(8 + h * 0.01).toFixed(2)},${h === 72 ? '' : 25}`);
  }
  const o = parseSnotelCsv(lines.join('\n'));
  assert.equal(o.depthIn, 42);
  assert.ok(o.new24In >= 11 && o.new24In <= 12.5, `got ${o.new24In}`);
  assert.ok(o.new72In >= o.new24In);
});

test('SNOTEL daily CSV gives per-day new snow from depth change', () => {
  const csv = ['#x', 'Date,Snow Depth (in) Start of Day Values', '2026-11-18,30', '2026-11-19,36', '2026-11-20,34', '2026-11-21,', '2026-11-22,40'].join('\n');
  const d = parseSnotelDailyCsv(csv);
  assert.deepEqual(d.map((x) => x.newIn), [6, 0, null, null]);
  assert.equal(d[0].date, '2026-11-18');
});

test('processPoint splits past days into history', () => {
  const nowMs = Date.UTC(2026, 10, 24, 20); // Nov 24 noon PST; fake data starts Nov 22
  const out = processPoint(fakeLoc({}), 8000, nowMs);
  assert.deepEqual(out.history.map((d) => d.date), ['2026-11-22', '2026-11-23']);
  assert.equal(out.days[0].date, '2026-11-24');
});

test('detail: Day/Night periods, SLR, precip type, hourly per date', async () => {
  const { buildDetail, precipType, compass } = await import('../lib/detail.js');
  const n = 72, start = Date.UTC(2026, 10, 22, 0);
  const time = Array.from({ length: n }, (_, i) => new Date(start + i * 3600e3).toISOString().slice(0, 16));
  const h = { time };
  for (const { key } of MODELS) {
    h[`temperature_2m_${key}`] = time.map((_, i) => (i < 30 ? -5 : 4));
    h[`apparent_temperature_${key}`] = time.map(() => -10);
    h[`relative_humidity_2m_${key}`] = time.map(() => 80);
    h[`precipitation_${key}`] = time.map((_, i) => (i >= 18 && i < 42 ? 1 : 0));
    h[`wind_speed_10m_${key}`] = time.map(() => 10);
    h[`wind_direction_10m_${key}`] = time.map(() => 112.5);
    h[`wind_gusts_10m_${key}`] = time.map(() => 20);
    h[`cloud_cover_${key}`] = time.map(() => 90);
  }
  const d = buildDetail({ utc_offset_seconds: 0, hourly: h }, 8000, Date.UTC(2026, 10, 22, 10));
  assert.equal(d.periods[0].date, '2026-11-22');
  assert.equal(d.periods[0].part, 'Day');
  const night = d.periods[1];
  assert.equal(night.part, 'Night');
  assert.equal(night.type, 'snow');
  assert.ok(night.snowIn > 3 && night.slr >= 15, JSON.stringify({ s: night.snowIn, slr: night.slr }));
  assert.equal(d.periods[2].type, 'rain');
  assert.equal(compass(112.5), 'ESE');
  assert.equal(precipType(0, 0), 'none');
  assert.equal(night.pop, 100);
  assert.equal(d.hours.filter((x) => x.date === '2026-11-23').length, 24);
});
