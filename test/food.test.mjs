import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFood, inRing, foodQuery } from '../lib/food.js';

test('food: inside ski-area outline or near base = slopeside; dedupe; unnamed dropped', () => {
  const lat = 39.1969, lon = -120.2358;
  const sq = [[39.17, -120.28], [39.17, -120.22], [39.20, -120.22], [39.20, -120.28], [39.17, -120.28]];
  const els = [
    { type: 'way', id: 9, tags: { landuse: 'winter_sports' }, geometry: sq.map(([a, b]) => ({ lat: a, lon: b })) },
    { type: 'node', id: 1, lat: 39.18, lon: -120.26, tags: { name: 'High Camp', amenity: 'restaurant', cuisine: 'american;burger' } },
    { type: 'node', id: 2, lat: 39.1972, lon: -120.2355, tags: { name: 'Base Bar', amenity: 'bar' } },
    { type: 'way', id: 3, center: { lat: 39.17, lon: -120.14 }, tags: { name: 'Tahoe City Cafe', amenity: 'cafe' } },
    { type: 'node', id: 4, lat: 39.17, lon: -120.14, tags: { amenity: 'restaurant' } },
    { type: 'node', id: 5, lat: 39.18, lon: -120.26, tags: { name: 'High Camp', amenity: 'restaurant' } },
  ];
  const out = buildFood(els, lat, lon);
  assert.deepEqual(out.slopeside.map((p) => p.name), ['Base Bar', 'High Camp']);
  assert.deepEqual(out.town.map((p) => p.name), ['Tahoe City Cafe']);
  assert.equal(out.slopeside[1].cuisine, 'american, burger');
  assert.equal(out.skiAreaMapped, true);
  assert.equal(inRing([39.25, -120.25], sq), false);
  assert.match(foodQuery(1, 2), /out geom;/);
});
