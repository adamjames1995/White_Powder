// Resort definitions. Elevations in feet. Add a resort by appending an entry.
// snotel: nearest NRCS SNOTEL station (US only) used for observed new snow/depth.
// Default mountains (fully configured: elevations, SNOTEL station, official cams page).
export const RESORTS = [
  {
    id: 'palisades',
    name: 'Palisades Tahoe',
    region: 'Olympic Valley, CA', state: 'California', country: 'USA',
    lat: 39.1969, lon: -120.2358,
    baseFt: 6200, summitFt: 9050,
    snotel: { triplet: '784:CA:SNTL', name: 'Squaw Valley G.C.' },
    camsUrl: 'https://www.palisadestahoe.com/mountain-information/webcams',
    site: 'palisadestahoe.com',
    cams: [
      { name: 'Palisades Base Area', embed: 'https://relay.ozolio.com/pub.api?cmd=explore&oid=CID_PGUS00000B0B&channel=0', preview: 'https://cdn-www.ozolio.com/pub.api?cmd=avatar&oid=CID_PGUS00000B0B' },
      { name: 'KT-22 (HDOnTap)', link: 'https://hdontap.com/stream/762258/palisades-tahoe-kt-22-live-webcam/', preview: 'https://storage.hdontap.com/wowza_stream_thumbnails/snapshot_hosb6_squaw-kt22_ttv.stream_FqyeNLd.jpg' },
    ],
    liftie: 'palisades',
    opening: '2026-11-25',
    trailMapUrl: 'https://www.palisadestahoe.com/mountain-information/trail-maps',
  },
  {
    id: 'kirkwood',
    name: 'Kirkwood',
    region: 'Kirkwood, CA', state: 'California', country: 'USA',
    lat: 38.6847, lon: -120.0657,
    baseFt: 7800, summitFt: 9800,
    snotel: { triplet: '1067:CA:SNTL', name: 'Carson Pass' },
    camsUrl: 'https://www.kirkwood.com/the-mountain/mountain-conditions/mountain-cams.aspx',
    site: 'kirkwood.com',
    cams: [
      { name: "Cornice", embed: 'https://player.brownrice.com/embed/kirkwoodcornice', preview: 'https://player.brownrice.com/snapshot/kirkwoodcornice' },
      { name: "Red Cliffs", embed: 'https://player.brownrice.com/embed/kirkwoodredcliffs', preview: 'https://player.brownrice.com/snapshot/kirkwoodredcliffs' },
    ],
    liftie: 'kirkwood',
    opening: '2026-11-23',
    trailMapUrl: 'https://www.kirkwood.com/the-mountain/about-the-mountain/trail-map.aspx',
  },
  {
    id: 'whistler',
    name: 'Whistler Blackcomb',
    region: 'Whistler, BC', state: 'British Columbia', country: 'Canada',
    lat: 50.0800, lon: -122.9400,
    baseFt: 2214, summitFt: 7494,
    snotel: null, // no SNOTEL in Canada — observed snow falls back to modeled
    camsUrl: 'https://www.whistlerblackcomb.com/the-mountain/mountain-conditions/mountain-cams.aspx',
    site: 'whistlerblackcomb.com',
    cams: [
      { name: "Roundhouse Lodge", embed: 'https://player.brownrice.com/embed/whistlerroundhouse', preview: 'https://player.brownrice.com/snapshot/whistlerroundhouse' },
      { name: "Whistler Peak", embed: 'https://player.brownrice.com/embed/whistlerpeak', preview: 'https://player.brownrice.com/snapshot/whistlerpeak' },
      { name: "Rendezvous Lodge", embed: 'https://player.brownrice.com/embed/whistlerblackcomb', preview: 'https://player.brownrice.com/snapshot/whistlerblackcomb' },
      { name: "7th Heaven", embed: 'https://player.brownrice.com/embed/whistler7thheaven', preview: 'https://player.brownrice.com/snapshot/whistler7thheaven' },
      { name: "Snow Stake", embed: 'https://player.brownrice.com/embed/whistlersnowstack', preview: 'https://player.brownrice.com/snapshot/whistlersnowstack' },
      { name: "Whistler Village", embed: 'https://player.brownrice.com/embed/whistlervillagefitz', preview: 'https://player.brownrice.com/snapshot/whistlervillagefitz' },
      { name: "Blackcomb Base", embed: 'https://player.brownrice.com/embed/whistlervillage', preview: 'https://player.brownrice.com/snapshot/whistlervillage' },
      { name: "Creekside", embed: 'https://player.brownrice.com/embed/whistlercreekside', preview: 'https://player.brownrice.com/snapshot/whistlercreekside' },
    ],
    liftie: 'whistler-blackcomb',
    opening: '2026-11-20',
    trailMapUrl: 'https://www.whistlerblackcomb.com/the-mountain/about-the-mountain/trail-map.aspx',
  },
  {
    id: 'stevens',
    name: 'Stevens Pass',
    region: 'Skykomish, WA', state: 'Washington', country: 'USA',
    lat: 47.7440, lon: -121.0890,
    baseFt: 4061, summitFt: 5845,
    snotel: { triplet: '791:WA:SNTL', name: 'Stevens Pass' },
    camsUrl: 'https://www.stevenspass.com/the-mountain/mountain-conditions/mountain-cams.aspx',
    site: 'stevenspass.com',
    cams: [
      { name: "Snow Stake", embed: 'https://player.brownrice.com/embed/stevenspasssnowstake', preview: 'https://player.brownrice.com/snapshot/stevenspasssnowstake' },
      { name: "Courtyard", embed: 'https://player.brownrice.com/embed/stevenspasscourtyard', preview: 'https://player.brownrice.com/snapshot/stevenspasscourtyard' },
      { name: "Jupiter", embed: 'https://player.brownrice.com/embed/stevenspassjupiter', preview: 'https://player.brownrice.com/snapshot/stevenspassjupiter' },
      { name: "Skyline", embed: 'https://player.brownrice.com/embed/stevenspassskyline', preview: 'https://player.brownrice.com/snapshot/stevenspassskyline' },
      { name: "Ski & Snowboard School", embed: 'https://player.brownrice.com/embed/stevenspassschool', preview: 'https://player.brownrice.com/snapshot/stevenspassschool' },
    ],
    liftie: 'stevens',
    opening: '2026-12-04',
    trailMapUrl: 'https://www.stevenspass.com/the-mountain/about-the-mountain/trail-map.aspx',
  },
  {
    id: 'crystal',
    opening: '2026-11-27',
    name: 'Crystal Mountain',
    region: 'Enumclaw, WA', state: 'Washington', country: 'USA',
    lat: 46.9350, lon: -121.4748,
    baseFt: 4400, summitFt: 7012,
    snotel: { triplet: '418:WA:SNTL', name: 'Corral Pass' },
    camsUrl: 'https://www.crystalmountainresort.com/the-mountain/webcams',
    site: 'crystalmountainresort.com',
    cams: [
      { name: "360 Summit", embed: 'https://crystalmountainresort.roundshot.com/summit/' },
      { name: "Mt. Rainier", embed: 'https://vauth.command.verkada.com/__v/crystal-mountain-resort/embed/html/f1bf4c8a-f709-44a7-ae9a-9be95e21a2c7/' },
      { name: "Top of Chair 6", embed: 'https://vauth.command.verkada.com/__v/crystal-mountain-resort/embed/html/78fb7824-8f99-4159-acec-c0a83873acd7/' },
      { name: "Snow Stake", embed: 'https://vauth.command.verkada.com/__v/crystal-mountain-resort/embed/html/87ce692f-51c5-4b15-95cc-6962c57039c1/' },
      { name: "Gold Hills", embed: 'https://vauth.command.verkada.com/__v/crystal-mountain-resort/embed/html/26c86345-fe7d-43cd-80b3-a3b62cf0c195/' },
      { name: "Northway Lift", embed: 'https://vauth.command.verkada.com/__v/crystal-mountain-resort/embed/html/0ff3d039-b876-4d20-bac0-e8c6c8007297/' },
    ],
    liftie: 'crystal-mountain',
    trailMapUrl: 'https://www.crystalmountainresort.com/the-mountain/trail-maps',
  },
];

// Resort icon: the resort's own site icon via Google's favicon service (falls back to initials).
export const logoUrl = (r) => (r.site ? `https://www.google.com/s2/favicons?domain=${r.site}&sz=128` : '');

// Quick-add catalog: name, state/region, country, approx. base-area lat/lon, website.
// Base/summit elevations are measured from terrain data when a mountain is added (editable).
// Opening dates for 2026-27: announced by the resort where available; '~' = projected/typical (not yet announced).
const OPEN = { "Mammoth Mountain": "2026-11-05", "Heavenly": "2026-11-20", "Northstar": "2026-11-20", "Sugar Bowl": "~2026-11-22", "Sierra-at-Tahoe": "~2026-11-25", "Mt. Rose": "2026-11-06", "Mt. Bachelor": "2026-12-04", "Mt. Hood Meadows": "2026-12-04", "Timberline": "~2026-11-27", "Mt. Baker": "~2026-12-04", "Summit at Snoqualmie": "~2026-12-04", "White Pass": "~2026-12-19", "Mission Ridge": "~2026-12-04", "Schweitzer": "2026-11-27", "Sun Valley": "~2026-12-05", "Big Sky": "2026-11-25", "Whitefish Mountain": "2026-12-04", "Jackson Hole": "2026-11-27", "Grand Targhee": "2026-11-20", "Snowbird": "2026-11-27", "Alta": "2026-11-20", "Brighton": "2026-11-24", "Solitude": "2026-11-20", "Park City": "2026-11-20", "Deer Valley": "2026-12-05", "Snowbasin": "2026-11-27", "Powder Mountain": "2026-12-11", "Vail": "2026-11-13", "Beaver Creek": "2026-11-25", "Breckenridge": "2026-11-11", "Keystone": "2026-10-30", "Copper Mountain": "2026-11-08", "Arapahoe Basin": "2026-10-28", "Winter Park": "2026-11-13", "Steamboat": "2026-11-21", "Aspen Snowmass": "2026-11-26", "Telluride": "2026-11-26", "Crested Butte": "2026-11-25", "Wolf Creek": "~2026-10-31", "Taos Ski Valley": "2026-11-26", "Arizona Snowbowl": "~2026-11-20", "Alyeska": "2026-11-28", "Killington": "2026-11-17", "Stowe": "2026-11-21", "Jay Peak": "2026-11-26", "Sugarbush": "~2026-11-21", "Sugarloaf": "2026-11-20", "Sunday River": "~2026-11-20", "Loon Mountain": "~2026-11-20", "Whiteface": "~2026-11-21", "Revelstoke": "2026-12-05", "Kicking Horse": "~2026-12-12", "Big White": "2026-11-26", "Sun Peaks": "2026-11-21", "RED Mountain": "~2026-12-12", "Fernie": "~2026-11-29", "Lake Louise": "2026-11-06", "Sunshine Village": "~2026-11-06", "Mont Tremblant": "~2026-11-26", "Chamonix": "~2026-11-28", "Tignes": "2026-11-22", "Courchevel": "~2026-12-05", "Zermatt": "~2026-11-21", "Verbier": "~2026-12-05", "St. Moritz": "~2026-11-28", "St. Anton am Arlberg": "2026-12-02", "Ischgl": "2026-11-26", "Kitzbühel": "2026-11-06", "Val Gardena": "~2026-12-05", "Niseko United": "~2026-11-27", "Rusutsu": "~2026-11-28", "Hakuba Happo-one": "~2026-12-05", "Nozawa Onsen": "~2026-12-12", "Portillo": "~2027-06-19", "Valle Nevado": "~2027-06-12", "Cerro Catedral": "~2027-06-19", "Thredbo": "~2027-06-05", "Perisher": "~2027-06-05", "Coronet Peak": "~2027-06-12", "The Remarkables": "~2027-06-12", "Mt Hutt": "~2027-06-12", "Val d'Isère": "2026-11-28", "Cortina d'Ampezzo": "~2026-11-28" };
const C = (name, state, country, lat, lon, site) => {
  const o = OPEN[name] || '';
  return { name, state, country, lat, lon, site, opening: o.replace('~', '') || null, openingEst: o.startsWith('~') };
};
export const CATALOG = [
  C('Mammoth Mountain', 'California', 'USA', 37.6308, -119.0326, 'mammothmountain.com'),
  C('Heavenly', 'California', 'USA', 38.9353, -119.94, 'skiheavenly.com'),
  C('Northstar', 'California', 'USA', 39.2746, -120.121, 'northstarcalifornia.com'),
  C('Sugar Bowl', 'California', 'USA', 39.3047, -120.3356, 'sugarbowl.com'),
  C('Sierra-at-Tahoe', 'California', 'USA', 38.799, -120.08, 'sierraattahoe.com'),
  C('Mt. Rose', 'Nevada', 'USA', 39.3285, -119.885, 'skirose.com'),
  C('Mt. Bachelor', 'Oregon', 'USA', 43.9792, -121.6886, 'mtbachelor.com'),
  C('Mt. Hood Meadows', 'Oregon', 'USA', 45.3311, -121.665, 'skihood.com'),
  C('Timberline', 'Oregon', 'USA', 45.3311, -121.711, 'timberlinelodge.com'),
  C('Mt. Baker', 'Washington', 'USA', 48.857, -121.665, 'mtbaker.us'),
  C('Summit at Snoqualmie', 'Washington', 'USA', 47.421, -121.413, 'summitatsnoqualmie.com'),
  C('White Pass', 'Washington', 'USA', 46.637, -121.391, 'skiwhitepass.com'),
  C('Mission Ridge', 'Washington', 'USA', 47.293, -120.399, 'missionridge.com'),
  C('Schweitzer', 'Idaho', 'USA', 48.368, -116.623, 'schweitzer.com'),
  C('Sun Valley', 'Idaho', 'USA', 43.671, -114.364, 'sunvalley.com'),
  C('Big Sky', 'Montana', 'USA', 45.284, -111.401, 'bigskyresort.com'),
  C('Whitefish Mountain', 'Montana', 'USA', 48.482, -114.356, 'skiwhitefish.com'),
  C('Jackson Hole', 'Wyoming', 'USA', 43.5877, -110.8279, 'jacksonhole.com'),
  C('Grand Targhee', 'Wyoming', 'USA', 43.787, -110.958, 'grandtarghee.com'),
  C('Snowbird', 'Utah', 'USA', 40.581, -111.657, 'snowbird.com'),
  C('Alta', 'Utah', 'USA', 40.5884, -111.6386, 'alta.com'),
  C('Brighton', 'Utah', 'USA', 40.598, -111.583, 'brightonresort.com'),
  C('Solitude', 'Utah', 'USA', 40.6199, -111.5919, 'solitudemountain.com'),
  C('Park City', 'Utah', 'USA', 40.6514, -111.508, 'parkcitymountain.com'),
  C('Deer Valley', 'Utah', 'USA', 40.6375, -111.4783, 'deervalley.com'),
  C('Snowbasin', 'Utah', 'USA', 41.216, -111.857, 'snowbasin.com'),
  C('Powder Mountain', 'Utah', 'USA', 41.379, -111.781, 'powdermountain.com'),
  C('Vail', 'Colorado', 'USA', 39.6403, -106.3742, 'vail.com'),
  C('Beaver Creek', 'Colorado', 'USA', 39.6042, -106.5165, 'beavercreek.com'),
  C('Breckenridge', 'Colorado', 'USA', 39.4817, -106.0384, 'breckenridge.com'),
  C('Keystone', 'Colorado', 'USA', 39.606, -105.954, 'keystoneresort.com'),
  C('Copper Mountain', 'Colorado', 'USA', 39.5022, -106.1511, 'coppercolorado.com'),
  C('Arapahoe Basin', 'Colorado', 'USA', 39.6425, -105.8719, 'arapahoebasin.com'),
  C('Winter Park', 'Colorado', 'USA', 39.8868, -105.7625, 'winterparkresort.com'),
  C('Steamboat', 'Colorado', 'USA', 40.4572, -106.8045, 'steamboat.com'),
  C('Aspen Snowmass', 'Colorado', 'USA', 39.2084, -106.949, 'aspensnowmass.com'),
  C('Telluride', 'Colorado', 'USA', 37.9375, -107.8123, 'tellurideskiresort.com'),
  C('Crested Butte', 'Colorado', 'USA', 38.8986, -106.965, 'skicb.com'),
  C('Wolf Creek', 'Colorado', 'USA', 37.4722, -106.793, 'wolfcreekski.com'),
  C('Taos Ski Valley', 'New Mexico', 'USA', 36.596, -105.454, 'skitaos.com'),
  C('Arizona Snowbowl', 'Arizona', 'USA', 35.331, -111.711, 'snowbowl.ski'),
  C('Alyeska', 'Alaska', 'USA', 60.97, -149.098, 'alyeskaresort.com'),
  C('Killington', 'Vermont', 'USA', 43.6045, -72.8201, 'killington.com'),
  C('Stowe', 'Vermont', 'USA', 44.5303, -72.7814, 'stowe.com'),
  C('Jay Peak', 'Vermont', 'USA', 44.927, -72.505, 'jaypeakresort.com'),
  C('Sugarbush', 'Vermont', 'USA', 44.136, -72.903, 'sugarbush.com'),
  C('Sugarloaf', 'Maine', 'USA', 45.0314, -70.3131, 'sugarloaf.com'),
  C('Sunday River', 'Maine', 'USA', 44.473, -70.857, 'sundayriver.com'),
  C('Loon Mountain', 'New Hampshire', 'USA', 44.036, -71.621, 'loonmtn.com'),
  C('Whiteface', 'New York', 'USA', 44.3659, -73.9026, 'whiteface.com'),
  C('Revelstoke', 'British Columbia', 'Canada', 50.958, -118.163, 'revelstokemountainresort.com'),
  C('Kicking Horse', 'British Columbia', 'Canada', 51.298, -117.048, 'kickinghorseresort.com'),
  C('Big White', 'British Columbia', 'Canada', 49.722, -118.929, 'bigwhite.com'),
  C('Sun Peaks', 'British Columbia', 'Canada', 50.884, -119.882, 'sunpeaksresort.com'),
  C('RED Mountain', 'British Columbia', 'Canada', 49.102, -117.846, 'redresort.com'),
  C('Fernie', 'British Columbia', 'Canada', 49.463, -115.087, 'skifernie.com'),
  C('Lake Louise', 'Alberta', 'Canada', 51.4419, -116.1622, 'skilouise.com'),
  C('Sunshine Village', 'Alberta', 'Canada', 51.115, -115.763, 'skibanff.com'),
  C('Mont Tremblant', 'Quebec', 'Canada', 46.21, -74.585, 'tremblant.ca'),
  C('Chamonix', 'Haute-Savoie', 'France', 45.9237, 6.8694, 'chamonix.com'),
  C("Val d'Isère", 'Savoie', 'France', 45.4486, 6.9806, 'valdisere.com'),
  C('Tignes', 'Savoie', 'France', 45.468, 6.906, 'tignes.net'),
  C('Courchevel', 'Savoie', 'France', 45.4154, 6.6347, 'courchevel.com'),
  C('Zermatt', 'Valais', 'Switzerland', 46.0207, 7.7491, 'zermatt.ch'),
  C('Verbier', 'Valais', 'Switzerland', 46.0961, 7.2286, 'verbier.ch'),
  C('St. Moritz', 'Graubünden', 'Switzerland', 46.4908, 9.8355, 'stmoritz.com'),
  C('St. Anton am Arlberg', 'Tyrol', 'Austria', 47.1296, 10.2682, 'stantonamarlberg.com'),
  C('Ischgl', 'Tyrol', 'Austria', 47.0128, 10.2919, 'ischgl.com'),
  C('Kitzbühel', 'Tyrol', 'Austria', 47.4464, 12.3922, 'kitzbuehel.com'),
  C("Cortina d'Ampezzo", 'Veneto', 'Italy', 46.5405, 12.1357, 'dolomiti.org'),
  C('Val Gardena', 'South Tyrol', 'Italy', 46.558, 11.672, 'valgardena.it'),
  C('Niseko United', 'Hokkaido', 'Japan', 42.86, 140.699, 'niseko.ne.jp'),
  C('Rusutsu', 'Hokkaido', 'Japan', 42.748, 140.899, 'rusutsu.com'),
  C('Hakuba Happo-one', 'Nagano', 'Japan', 36.698, 137.832, 'happo-one.jp'),
  C('Nozawa Onsen', 'Nagano', 'Japan', 36.922, 138.447, 'nozawaski.com'),
  C('Portillo', 'Valparaíso', 'Chile', -32.835, -70.13, 'skiportillo.com'),
  C('Valle Nevado', 'Santiago', 'Chile', -33.357, -70.249, 'vallenevado.com'),
  C('Cerro Catedral', 'Río Negro', 'Argentina', -41.169, -71.439, 'catedralaltapatagonia.com'),
  C('Thredbo', 'New South Wales', 'Australia', -36.505, 148.305, 'thredbo.com.au'),
  C('Perisher', 'New South Wales', 'Australia', -36.406, 148.411, 'perisher.com.au'),
  C('Coronet Peak', 'Otago', 'New Zealand', -44.926, 168.735, 'coronetpeak.co.nz'),
  C('The Remarkables', 'Otago', 'New Zealand', -45.054, 168.813, 'theremarkables.co.nz'),
  C('Mt Hutt', 'Canterbury', 'New Zealand', -43.47, 171.53, 'mthutt.co.nz'),
];

export const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const byId = (id) => RESORTS.find((r) => r.id === id);

// Expected opening for any mountain: its own date, the catalog's, or a typical date for its hemisphere.
export function openingFor(r) {
  if (r.opening) return { date: r.opening, est: !!r.openingEst };
  const c = CATALOG.find((x) => x.name === r.name);
  if (c?.opening) return { date: c.opening, est: c.openingEst };
  const now = new Date(), y = now.getFullYear();
  if (r.lat < 0) { // southern hemisphere: season starts mid-June
    const d = `${now.getMonth() >= 9 ? y + 1 : y}-06-13`;
    return { date: d, est: true, typical: true };
  }
  return { date: `${now.getMonth() < 6 ? y - 1 : y}-11-27`, est: true, typical: true };
}
