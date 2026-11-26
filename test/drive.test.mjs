import test from 'node:test';
import assert from 'node:assert/strict';
import { chainLevel, chainAdvice, passAdvice, pickLeave, googleMapsUrl, sampleRoute, packList } from '../lib/drive.js';

test('chain levels and vehicle advice', () => {
  assert.equal(chainLevel('R-2', ''), 2);
  assert.equal(chainLevel('R-0', 'No chain controls are in effect at this time.'), 0);
  const awdSnow = { drive: 'awd', tires: 'snow', chains: true }, fwd = { drive: '2wd', tires: 'allseason', chains: false };
  assert.equal(chainAdvice(2, awdSnow).ok, true);
  assert.equal(chainAdvice(2, fwd).ok, false);
  assert.equal(chainAdvice(1, { drive: 'awd', tires: 'allseason' }).ok, true);
  assert.equal(chainAdvice(3, awdSnow).ok, false);
  assert.equal(passAdvice('Chains required on all vehicles except all wheel drive', { drive: 'awd' }).ok, true);
  assert.equal(passAdvice('Chains required on all vehicles except all wheel drive', { drive: '2wd' }).ok, false);
});

test('leave time works back from first chair and avoids traffic', () => {
  const day = new Date(2026, 11, 19); day.setHours(0, 0, 0, 0);
  const d0 = day.getTime();
  const iso = (h, m) => new Date(d0 + h * 3600e3 + m * 60e3).toISOString();
  // heavy traffic if you leave after 6:00
  const times = [[4, 30, 180], [5, 0, 182], [5, 30, 185], [6, 0, 215], [6, 30, 240]].map(([h, m, min]) => ({ depart: iso(h, m), min, delayMin: min - 180 }));
  const r = pickLeave({ dayStart: d0, firstChair: '09:00', baseMin: 180, times, samples: [], now: d0 - 86400e3 });
  const leaveH = new Date(r.leave).getHours() + new Date(r.leave).getMinutes() / 60;
  assert.ok(leaveH >= 4.5 && leaveH <= 5.75, `leave ${new Date(r.leave).toTimeString()}`);
  assert.ok(r.arrive <= d0 + 8.5 * 3600e3 + 60e3, 'arrives 30 min before first chair');
});

test('map link and route sampling', () => {
  const coords = Array.from({ length: 200 }, (_, i) => [37 + i * 0.01, -121 + i * 0.005]);
  const u = googleMapsUrl([37, -121], 'Kirkwood', null, coords);
  assert.match(u, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
  assert.match(decodeURIComponent(u), /waypoints=[\d.,-]+\|[\d.,-]+\|[\d.,-]+/);
  const s = sampleRoute(coords, 20);
  assert.ok(s.length >= 5 && s[s.length - 1].frac === 1);
  assert.ok(packList({ v: { drive: '2wd', tires: 'allseason', chains: false }, chainMax: 2 }).some((x) => x.k === 'chains' && x.must));
});

test('goals give different leave times', () => {
  const day = new Date(2026, 11, 19); day.setHours(0, 0, 0, 0); // a Saturday
  const d0 = day.getTime(), iso = (h, m) => new Date(d0 + h * 3600e3 + m * 60e3).toISOString();
  const times = [[3, 30, 180], [4, 0, 180], [4, 30, 182], [5, 0, 186], [5, 30, 200], [6, 0, 225], [6, 30, 240]].map(([h, m, min]) => ({ depart: iso(h, m), min, delayMin: min - 180 }));
  // snow on the pass from 5 to 8 AM
  const hours = Array.from({ length: 24 }, (_, i) => d0 + i * 3600e3);
  const samples = [{ frac: 0.8, elevFt: 7000, name: 'Carson Pass', hourly: { t: hours, snow: hours.map((_, i) => (i >= 5 && i < 9 ? 0.8 : 0)), temp: hours.map(() => 25), precip: hours.map(() => 0) } }];
  const P = (goal) => pickLeave({ goal, dayStart: d0, firstChair: '09:00', baseMin: 180, times, samples, now: d0 - 86400e3 });
  const chair = P('chair'), parking = P('parking'), weather = P('weather'), traffic = P('traffic');
  assert.ok(parking.leave < chair.leave, 'parking leaves earlier');
  assert.ok(weather.weatherMin <= chair.weatherMin, 'weather goal avoids snow');
  assert.ok(traffic.trafficMin <= chair.trafficMin, 'traffic goal minimizes delay');
});
