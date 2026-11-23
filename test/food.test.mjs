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
  assert.match(foodQuery(1, 2), /out bb tags;/);
});

test('food: out-bb bounds count as ski area; Nominatim results convert', async () => {
  const { buildFood, nominatimToElements, nominatimUrl } = await import('../lib/food.js');
  const els = [
    { type: 'relation', id: 7, tags: { landuse: 'winter_sports' }, bounds: { minlat: 39.17, minlon: -120.28, maxlat: 39.2, maxlon: -120.22 } },
    ...nominatimToElements([
      { osm_type: 'node', osm_id: 1, lat: '39.18', lon: '-120.26', name: 'Gold Coast', category: 'amenity', type: 'restaurant', extratags: { cuisine: 'american' } },
      { osm_type: 'node', osm_id: 2, lat: '39.30', lon: '-120.10', name: 'Truckee Diner', category: 'amenity', type: 'restaurant' },
      { osm_type: 'way', osm_id: 3, lat: '39.2', lon: '-120.2', name: 'Some Hotel', category: 'tourism', type: 'hotel' },
    ]),
  ];
  const out = buildFood(els, 39.1969, -120.2358);
  assert.deepEqual(out.slopeside.map((p) => p.name), ['Gold Coast']);
  assert.deepEqual(out.town.map((p) => p.name), ['Truckee Diner']);
  // Without an outline, slopeside = within 2 km
  const out2 = buildFood(nominatimToElements([{ osm_id: 9, lat: '39.205', lon: '-120.24', name: 'Village Cafe', category: 'amenity', type: 'cafe' }]), 39.1969, -120.2358);
  assert.equal(out2.slopeside.length, 1);
  assert.match(nominatimUrl('cafe', 39.2, -120.2), /bounded=1/);
});

test('trailmap: picks nearest OpenSkiMap area with name match and extracts Skimap.org images', async () => {
  const { pickSkiArea, extractMaps } = await import('../api/trailmap.js');
  const feats = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-120.25, 39.19] }, properties: { type: 'skiArea', id: 'osm-a', name: 'Palisades Tahoe', sources: [{ type: 'skimap.org', id: '123' }, { type: 'openstreetmap', id: 'way/1' }] } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-120.24, 39.18], [-120.2, 39.18], [-120.2, 39.2], [-120.24, 39.18]]] }, properties: { type: 'skiArea', id: 'osm-b', name: 'Other Hill', sources: [] } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-106.37, 39.64] }, properties: { type: 'skiArea', id: 'far', name: 'Palisades Tahoe' } },
  ];
  const a = pickSkiArea(feats, 39.1969, -120.2358, 'Palisades Tahoe');
  assert.equal(a.openskimapId, 'osm-a');
  assert.equal(a.skimapId, '123');
  const maps = extractMaps({ ski_maps: [
    { id: 1, year_published: 2019, media: { image: { url: 'https://files.skimap.org/a/large.jpg' }, thumb: 'https://files.skimap.org/a/thumb.jpg' } },
    { id: 2, year_published: 2024, file: 'https://files.skimap.org/b/full.png' },
  ] });
  assert.equal(maps[0].year, 2024);
  assert.equal(maps[1].image, 'https://files.skimap.org/a/large.jpg');
  assert.equal(maps[1].thumb, 'https://files.skimap.org/a/thumb.jpg');
});
