import test from 'node:test';
import assert from 'node:assert/strict';
import { split, shape } from '../api/food.js';

test('food split: in-area and near-base are slopeside, rest town; unnamed dropped; deduped', () => {
  const lat = 39.1969, lon = -120.2358;
  const els = [
    { type: 'node', id: 1, lat: 39.18, lon: -120.26, tags: { name: 'High Camp', amenity: 'restaurant', cuisine: 'american;burger' } },
    { type: 'node', id: 2, lat: 39.1972, lon: -120.2355, tags: { name: 'Base Bar', amenity: 'bar' } },
    { type: 'way', id: 3, center: { lat: 39.17, lon: -120.14 }, tags: { name: 'Tahoe City Cafe', amenity: 'cafe' } },
    { type: 'node', id: 4, lat: 39.17, lon: -120.14, tags: { amenity: 'restaurant' } },
    { type: 'node', id: 1, lat: 39.18, lon: -120.26, tags: { name: 'High Camp', amenity: 'restaurant' } },
  ];
  const out = split(new Set(['node/1']), els, lat, lon);
  assert.deepEqual(out.slopeside.map((p) => p.name), ['Base Bar', 'High Camp']);
  assert.deepEqual(out.town.map((p) => p.name), ['Tahoe City Cafe']);
  assert.equal(shape(els[0], lat, lon).cuisine, 'american, burger');
});
