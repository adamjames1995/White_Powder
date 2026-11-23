// Resort definitions. Elevations in feet. Add a resort by appending an entry.
// snotel: nearest NRCS SNOTEL station (US only) used for observed new snow/depth.
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
  },
  {
    id: 'crystal',
    name: 'Crystal Mountain',
    region: 'Enumclaw, WA', state: 'Washington', country: 'USA',
    lat: 46.9350, lon: -121.4748,
    baseFt: 4400, summitFt: 7012,
    snotel: { triplet: '418:WA:SNTL', name: 'Corral Pass' },
    camsUrl: 'https://www.crystalmountainresort.com/the-mountain/webcams',
    site: 'crystalmountainresort.com',
  },
];

// Resort icon: the resort's own site icon via Google's favicon service (falls back to initials).
export const logoUrl = (r) => `https://www.google.com/s2/favicons?domain=${r.site}&sz=128`;

export const byId = (id) => RESORTS.find((r) => r.id === id);
