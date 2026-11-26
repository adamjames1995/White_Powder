// Rider avatars: a tiny SVG skier/snowboarder built from a few choices, plus a (gently roasting) persona.
// Encoded as a short string so it rides along with squad updates: "s.2.4.1.3.0.2.5.7.3"

export const AV = {
  ride: [['ski', 'Skier'], ['board', 'Snowboarder']],
  skin: ['#f6d3b3', '#e8b48f', '#c98e66', '#a06a45', '#6e4529', '#f2c7a0'],
  helmet: ['#f5f5f2', '#1d1d1f', '#e63946', '#2a9df4', '#ffd23f', '#7b2ff7', '#22c55e', '#ff7ab6'],
  lens: [['#ffb703', '#fb5607', 'Gold'], ['#4cc9f0', '#3a0ca3', 'Blue mirror'], ['#ff8fab', '#b5179e', 'Rose'], ['#80ffdb', '#2b9348', 'Emerald'], ['#e0e0e0', '#3c3c3c', 'Smoke'], ['#ffe066', '#f72585', 'Sunset']],
  jacket: ['#e63946', '#2a9df4', '#ffd23f', '#22c55e', '#1d1d1f', '#ff7ab6', '#7b2ff7', '#ff8c00', '#00b4d8', '#f5f5f2'],
  pants: ['#1d1d1f', '#3d405b', '#e9c46a', '#2a9d8f', '#f5f5f2', '#e63946', '#6d597a'],
  extra: ['None', 'Beard', 'Stache', 'Helmet mohawk', 'Pom-pom', 'Bear ears', 'GoPro', 'Jorts'],
  title: ['Certified Jerry', 'Gaper Day Legend', 'Park Rat', 'Lift-Line Philosopher', 'Après Professional', 'Pizza Enthusiast (formerly French Fries)', 'Self-Proclaimed Ripper',
    'Yard Sale Champion', 'Goggle-Tan Supermodel', 'Chairlift Snack Dealer', 'First Chair, Last Call', 'Powder Day "Sick" Day', 'Tree-Well Avoider', 'Groomer Zoomer', 'Bunny Hill Royalty', 'Send-It Specialist'],
  move: ['The Yard Sale', 'Accidental 180', 'Backseat Driver', 'Pole Plant & Pray', 'Falling Leaf Forever', 'Sit-Down Skid Stop', 'Hockey-Stop Spray Attack', 'The Lift-Line Shuffle',
    'Sideways Down Everything', 'Confident Wrong Turn', 'Unplanned Butter', 'Chairlift Dismount Faceplant'],
  gnar: ['Bunny hill royalty', 'Greens & dreams', 'Blue square, full send', 'Black diamond (allegedly)', 'Double black, zero chill'],
};
const KEYS = ['ride', 'skin', 'helmet', 'lens', 'jacket', 'pants', 'extra', 'title', 'move', 'gnar'];
const len = (k) => AV[k].length;
const clampI = (k, v) => ((Number(v) % len(k)) + len(k)) % len(k) || 0;

export const DEFAULT_AV = { ride: 0, skin: 0, helmet: 2, lens: 0, jacket: 1, pants: 0, extra: 0, title: 0, move: 0, gnar: 2 };
export function randomAvatar(rand = Math.random) {
  const a = {}; for (const k of KEYS) a[k] = Math.floor(rand() * len(k)); return a;
}
export const encodeAv = (a) => KEYS.map((k) => clampI(k, a?.[k] ?? DEFAULT_AV[k])).join('.');
export function decodeAv(s) {
  const p = String(s || '').split('.');
  if (p.length !== KEYS.length || p.some((x) => !/^\d{1,2}$/.test(x))) return null;
  const a = {}; KEYS.forEach((k, i) => { a[k] = clampI(k, p[i]); }); return a;
}
export const avTitle = (a) => AV.title[clampI('title', a.title)];
export const avMove = (a) => AV.move[clampI('move', a.move)];
export const avGnar = (a) => AV.gnar[clampI('gnar', a.gnar)];
export const avRide = (a) => AV.ride[clampI('ride', a.ride)][0];

let uid = 0;
/** SVG of the rider. mode 'full' = whole body on gear, 'badge' = head & shoulders in a circle (map pins, lists). */
export function avatarSvg(a, { size = 120, mode = 'full', cls = '' } = {}) {
  a = { ...DEFAULT_AV, ...(a || {}) };
  const g = `av${++uid}`;
  const skin = AV.skin[clampI('skin', a.skin)], helm = AV.helmet[clampI('helmet', a.helmet)], [l1, l2] = AV.lens[clampI('lens', a.lens)];
  const jk = AV.jacket[clampI('jacket', a.jacket)], pt = AV.pants[clampI('pants', a.pants)], ex = clampI('extra', a.extra), board = avRide(a) === 'board';
  const dark = (c) => `color-mix(in srgb, ${c} 72%, #000)`;
  // head centred at (50,30)
  const head = `
    ${ex === 3 ? `<path d="M39 21 l2.5 -8 l3 7 l3 -9 l2.5 9 l2.5 -9 l3 9 l3 -7 l2.5 8 z" fill="#ff3d7f" stroke="#c9184a" stroke-width=".6"/>` : ''}
    ${ex === 5 ? `<circle cx="35" cy="16" r="5.5" fill="${helm}" stroke="${dark(helm)}" stroke-width="1"/><circle cx="35" cy="16" r="2.6" fill="#ffb3c6"/><circle cx="65" cy="16" r="5.5" fill="${helm}" stroke="${dark(helm)}" stroke-width="1"/><circle cx="65" cy="16" r="2.6" fill="#ffb3c6"/>` : ''}
    <ellipse cx="50" cy="35" rx="13" ry="12.5" fill="${skin}"/>
    <path d="M35 31 C35 15 65 15 65 31 L65 33 L35 33 Z" fill="${helm}" stroke="${dark(helm)}" stroke-width="1"/>
    <path d="M40 19 C46 16 55 16 60 19" stroke="#fff" stroke-opacity=".45" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    ${ex === 4 ? `<circle cx="50" cy="16.5" r="5" fill="#fff"/><circle cx="48" cy="15.5" r="1.6" fill="#e9ecef"/><circle cx="52.5" cy="17.5" r="1.4" fill="#dee2e6"/>` : ''}
    ${ex === 6 ? `<rect x="46" y="14.5" width="8" height="6" rx="1.2" fill="#222"/><circle cx="50" cy="17.5" r="1.8" fill="#4cc9f0"/>` : ''}
    <rect x="35.5" y="28.5" width="29" height="10" rx="5" fill="#111"/>
    <rect x="37" y="29.6" width="26" height="7.8" rx="3.9" fill="url(#${g}l)"/>
    <path d="M40 31 L45 31 L42 36 Z" fill="#fff" fill-opacity=".55"/>
    <path d="M44 43 Q50 47 56 43" stroke="${dark(skin)}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    ${ex === 1 ? `<path d="M38 39 Q38 52 50 53 Q62 52 62 39 Q57 44 50 44 Q43 44 38 39 Z" fill="#6b4226"/><path d="M45 44 Q50 46.5 55 44" stroke="#3b2414" stroke-width="1.2" fill="none"/>` : ''}
    ${ex === 2 ? `<path d="M42 41.5 Q46 39 50 41 Q54 39 58 41.5 Q55 43.5 50 42.6 Q45 43.5 42 41.5 Z" fill="#4a2c17"/>` : ''}`;
  const defs = `<defs><linearGradient id="${g}l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l1}"/><stop offset="1" stop-color="${l2}"/></linearGradient>
    <linearGradient id="${g}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9bd1ff"/><stop offset="1" stop-color="#e8f4ff"/></linearGradient></defs>`;
  if (mode === 'badge') {
    return `<svg class="av ${cls}" viewBox="22 4 56 56" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs}
      <circle cx="50" cy="32" r="28" fill="url(#${g}bg)"/>
      <clipPath id="${g}c"><circle cx="50" cy="32" r="28"/></clipPath>
      <g clip-path="url(#${g}c)"><path d="M28 70 Q28 48 50 48 Q72 48 72 70 Z" fill="${jk}"/><path d="M50 48 L50 70" stroke="${dark(jk)}" stroke-width="1"/>${head}</g>
      <circle cx="50" cy="32" r="27.2" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`;
  }
  const legs = board
    ? `<path d="M41 80 L38 99 L46 99 L48 82 Z M59 80 L62 99 L54 99 L52 82 Z" fill="${pt}" stroke="${dark(pt)}" stroke-width=".8"/>
       ${ex === 7 ? `<path d="M40 80 L60 80 L61 89 L52 89 L50 85 L48 89 L39 89 Z" fill="#7aa7d6" stroke="#4f7cac" stroke-width=".8"/>` : ''}
       <rect x="20" y="99" width="60" height="6" rx="3" fill="${helm}" stroke="${dark(helm)}" stroke-width="1" transform="rotate(-4 50 102)"/>
       <rect x="36" y="97" width="11" height="4" rx="1.5" fill="#222" transform="rotate(-4 50 102)"/><rect x="53" y="96.2" width="11" height="4" rx="1.5" fill="#222" transform="rotate(-4 50 102)"/>`
    : `<path d="M41 80 L39 100 L47 100 L49 82 Z M59 80 L61 100 L53 100 L51 82 Z" fill="${pt}" stroke="${dark(pt)}" stroke-width=".8"/>
       ${ex === 7 ? `<path d="M40 80 L60 80 L61 89 L52 89 L50 85 L48 89 L39 89 Z" fill="#7aa7d6" stroke="#4f7cac" stroke-width=".8"/>` : ''}
       <rect x="36" y="99" width="12" height="5" rx="2" fill="#222"/><rect x="52" y="99" width="12" height="5" rx="2" fill="#222"/>
       <path d="M24 106 L56 103" stroke="${jk}" stroke-width="3.2" stroke-linecap="round"/><path d="M44 103 L78 106" stroke="${jk}" stroke-width="3.2" stroke-linecap="round"/>
       <path d="M24 106 q-3 -0.5 -4 -3" stroke="${jk}" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M78 106 q3 -0.5 4 -3" stroke="${jk}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  const poles = board ? '' : `<path d="M30 64 L22 101" stroke="#bbb" stroke-width="1.6" stroke-linecap="round"/><path d="M70 64 L78 101" stroke="#bbb" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="22.6" cy="98" r="2.4" fill="none" stroke="#999" stroke-width="1"/><circle cx="77.4" cy="98" r="2.4" fill="none" stroke="#999" stroke-width="1"/>`;
  const arms = board
    ? `<path d="M36 55 Q24 60 20 70" stroke="${jk}" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M64 55 Q76 60 80 70" stroke="${jk}" stroke-width="7" fill="none" stroke-linecap="round"/>
       <circle cx="20" cy="71" r="3.6" fill="#222"/><circle cx="80" cy="71" r="3.6" fill="#222"/>`
    : `<path d="M36 55 Q28 60 30 65" stroke="${jk}" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M64 55 Q72 60 70 65" stroke="${jk}" stroke-width="7" fill="none" stroke-linecap="round"/>
       <circle cx="30" cy="65" r="3.6" fill="#222"/><circle cx="70" cy="65" r="3.6" fill="#222"/>`;
  return `<svg class="av ${cls}" viewBox="0 0 100 112" width="${size}" height="${size * 1.12}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs}
    <ellipse cx="50" cy="106" rx="34" ry="4" fill="#000" opacity=".18"/>
    ${poles}${legs}
    <path d="M36 50 Q50 45 64 50 L62 82 L38 82 Z" fill="${jk}" stroke="${dark(jk)}" stroke-width="1"/>
    <path d="M50 49 L50 82" stroke="${dark(jk)}" stroke-width="1"/><rect x="37" y="72" width="26" height="3" fill="${dark(jk)}" opacity=".5"/>
    ${arms}${head}</svg>`;
}
