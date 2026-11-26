// Rider avatars: an SVG skier/snowboarder built from choices + any number of accessories, with a (gently roasting) persona.
// Drawn as separate layers so the builder can show them as a rotatable, animated 3D rig.
// Stored as a compact string that rides along with squad updates (see encodeAv).

export const AV = {
  ride: [['ski', 'Skier'], ['board', 'Snowboarder']],
  skin: ['#f6d3b3', '#e8b48f', '#c98e66', '#a06a45', '#6e4529', '#f2c7a0'],
  helmStyle: ['Classic', 'Half-shell', 'Full-face', 'Beanie', 'Viking', 'Cowboy hat', 'Retro stripe', 'Shark'],
  color: ['#f5f5f2', '#1d1d1f', '#e63946', '#2a9df4', '#ffd23f', '#7b2ff7', '#22c55e', '#ff7ab6', '#ff8c00', '#00b4d8', '#3d405b', '#e9c46a'],
  eyewear: ['Goggles', 'Big frameless', 'Sunglasses', 'Goggles up', 'Nothing'],
  lens: [['#ffb703', '#fb5607', 'Gold'], ['#4cc9f0', '#3a0ca3', 'Blue mirror'], ['#ff8fab', '#b5179e', 'Rose'], ['#80ffdb', '#2b9348', 'Emerald'], ['#e0e0e0', '#3c3c3c', 'Smoke'], ['#ffe066', '#f72585', 'Sunset']],
  jacketStyle: ['Shell', 'Puffy', 'One-piece', 'Retro 80s', 'Flannel', 'Hoodie', 'Vest'],
  pantsStyle: ['Regular', 'Bibs', 'Baggy', 'Jorts over pants'],
  gnar: ['Bunny hill royalty', 'Greens & dreams', 'Blue square, full send', 'Black diamond (allegedly)', 'Double black, zero chill'],
  title: ['Certified Jerry', 'Après All Day', 'Gaper Day Legend', 'Park Rat', 'Lift-Line Philosopher', 'Après Professional', 'Pizza Enthusiast (formerly French Fries)', 'Self-Proclaimed Ripper',
    'Yard Sale Champion', 'Goggle-Tan Supermodel', 'Chairlift Snack Dealer', 'First Chair, Last Call', 'Powder Day "Sick" Day', 'Tree-Well Avoider', 'Groomer Zoomer', 'Bunny Hill Royalty', 'Send-It Specialist'],
  move: ['The Yard Sale', 'Accidental 180', 'Backseat Driver', 'Pole Plant & Pray', 'Falling Leaf Forever', 'Sit-Down Skid Stop', 'Hockey-Stop Spray Attack', 'The Lift-Line Shuffle',
    'Sideways Down Everything', 'Confident Wrong Turn', 'Unplanned Butter', 'Chairlift Dismount Faceplant'],
};
// Add-ons: any number at once.
export const ACC = [
  ['beard', 'Beard'], ['stache', 'Stache'], ['cheeks', 'Rosy cheeks'], ['mohawk', 'Helmet mohawk'], ['pompom', 'Pom-pom'], ['ears', 'Bear ears'], ['antlers', 'Antlers'],
  ['gopro', 'GoPro'], ['gaiter', 'Neck gaiter'], ['scarf', 'Scarf'], ['lei', 'Flower lei'], ['lanyard', 'Lift pass'], ['backpack', 'Backpack'], ['cape', 'Cape'],
  ['tutu', 'Tutu'], ['fanny', 'Fanny pack'], ['parrot', 'Shoulder parrot'], ['selfie', 'Selfie stick'], ['stickers', 'Sticker-bombed gear'],
];
const ACC_KEYS = new Set(ACC.map((x) => x[0]));
const IDX = ['ride', 'skin', 'helmStyle', 'helmet', 'eyewear', 'lens', 'jacketStyle', 'jacket', 'accent', 'pantsStyle', 'pants', 'gloves', 'gnar'];
const RANGE = { ride: AV.ride.length, skin: AV.skin.length, helmStyle: AV.helmStyle.length, helmet: AV.color.length, eyewear: AV.eyewear.length, lens: AV.lens.length,
  jacketStyle: AV.jacketStyle.length, jacket: AV.color.length, accent: AV.color.length, pantsStyle: AV.pantsStyle.length, pants: AV.color.length, gloves: AV.color.length, gnar: AV.gnar.length };
const ci = (k, v) => { const n = RANGE[k]; return ((Math.trunc(Number(v) || 0) % n) + n) % n; };
export const cleanText = (s, n = 32) => String(s ?? '').replace(/[<>|\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

export const DEFAULT_AV = { ride: 0, skin: 0, helmStyle: 0, helmet: 2, eyewear: 0, lens: 0, jacketStyle: 0, jacket: 3, accent: 4, pantsStyle: 0, pants: 1, gloves: 1, gnar: 2, acc: [], title: AV.title[0], move: AV.move[0] };

export function randomAvatar(rand = Math.random) {
  const a = {}; for (const k of IDX) a[k] = Math.floor(rand() * RANGE[k]);
  a.acc = ACC.map((x) => x[0]).filter(() => rand() < 0.16);
  a.title = AV.title[Math.floor(rand() * AV.title.length)];
  a.move = AV.move[Math.floor(rand() * AV.move.length)];
  return a;
}
export const normAv = (a) => {
  const o = { ...DEFAULT_AV, ...(a || {}) };
  for (const k of IDX) o[k] = ci(k, o[k]);
  o.acc = [...new Set((o.acc || []).filter((k) => ACC_KEYS.has(k)))];
  o.title = cleanText(o.title) || DEFAULT_AV.title; o.move = cleanText(o.move) || DEFAULT_AV.move;
  return o;
};
// "2|0.1.2.3.4.5.6.7.8.9.10.11.2|beard,cape|Certified Jerry|The Yard Sale"
export const encodeAv = (a) => { const o = normAv(a); return ['2', IDX.map((k) => o[k]).join('.'), o.acc.join(','), o.title, o.move].join('|'); };
const V1_TITLES = ['Certified Jerry', 'Gaper Day Legend', 'Park Rat', 'Lift-Line Philosopher', 'Après Professional', 'Pizza Enthusiast (formerly French Fries)', 'Self-Proclaimed Ripper',
  'Yard Sale Champion', 'Goggle-Tan Supermodel', 'Chairlift Snack Dealer', 'First Chair, Last Call', 'Powder Day "Sick" Day', 'Tree-Well Avoider', 'Groomer Zoomer', 'Bunny Hill Royalty', 'Send-It Specialist'];
export function decodeAv(s) {
  s = String(s || '');
  if (s.startsWith('2|')) {
    const [, nums, acc, title, move] = s.split('|');
    const p = (nums || '').split('.');
    if (p.length !== IDX.length || p.some((x) => !/^\d{1,2}$/.test(x))) return null;
    const a = {}; IDX.forEach((k, i) => { a[k] = Number(p[i]); });
    return normAv({ ...a, acc: (acc || '').split(',').filter(Boolean), title, move });
  }
  // v1: ride.skin.helmet.lens.jacket.pants.extra.title.move.gnar
  const p = s.split('.');
  if (p.length !== 10 || p.some((x) => !/^\d{1,2}$/.test(x))) return null;
  const n = p.map(Number), ex = ['', 'beard', 'stache', 'mohawk', 'pompom', 'ears', 'gopro', ''][n[6] % 8];
  const OLD_HELM = ['#f5f5f2', '#1d1d1f', '#e63946', '#2a9df4', '#ffd23f', '#7b2ff7', '#22c55e', '#ff7ab6'];
  const OLD_JK = ['#e63946', '#2a9df4', '#ffd23f', '#22c55e', '#1d1d1f', '#ff7ab6', '#7b2ff7', '#ff8c00', '#00b4d8', '#f5f5f2'];
  const OLD_PT = ['#1d1d1f', '#3d405b', '#e9c46a', '#2a9d8f', '#f5f5f2', '#e63946', '#6d597a'];
  const toNew = (hex) => Math.max(0, AV.color.indexOf(hex));
  return normAv({ ride: n[0], skin: n[1], helmet: toNew(OLD_HELM[n[2] % 8]), lens: n[3], jacket: toNew(OLD_JK[n[4] % 10]), pants: toNew(OLD_PT[n[5] % 7]),
    acc: ex ? [ex] : [], pantsStyle: n[6] % 8 === 7 ? 3 : 0, title: V1_TITLES[n[7] % V1_TITLES.length], move: AV.move[n[8] % AV.move.length], gnar: n[9] });
}
export const avTitle = (a) => normAv(a).title;
export const avMove = (a) => normAv(a).move;
export const avGnar = (a) => AV.gnar[normAv(a).gnar];
export const avRide = (a) => AV.ride[normAv(a).ride][0];

const dk = (c, p = 72) => `color-mix(in srgb, ${c} ${p}%, #000)`;
let uid = 0;

/** The rider as named SVG fragments (all in the same 0 0 100 112 space) plus defs. */
export function avatarLayers(raw) {
  const a = normAv(raw), has = (k) => a.acc.includes(k), g = `av${++uid}`;
  const skin = AV.skin[a.skin], helm = AV.color[a.helmet], jk = AV.color[a.jacket], ac = AV.color[a.accent];
  const pt = a.jacketStyle === 2 ? jk : AV.color[a.pants], gl = AV.color[a.gloves], [l1, l2] = AV.lens[a.lens];
  const board = a.ride === 1, hs = a.helmStyle, ew = a.eyewear, js = a.jacketStyle;
  const defs = `<defs><linearGradient id="${g}l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l1}"/><stop offset="1" stop-color="${l2}"/></linearGradient>
    <pattern id="${g}pl" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${jk}"/><rect width="6" height="2" fill="${ac}" opacity=".55"/><rect width="2" height="6" fill="${ac}" opacity=".55"/><rect x="4" width=".6" height="6" fill="#000" opacity=".25"/></pattern>
    <pattern id="${g}st" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="${helm}"/><circle cx="3" cy="4" r="2.2" fill="#ff3d7f"/><rect x="7" y="7" width="5" height="4" rx="1" fill="#22c55e"/><path d="M2 11 l2 -3 l2 3z" fill="#ffd23f"/><circle cx="11" cy="2.5" r="1.6" fill="#4cc9f0"/></pattern></defs>`;
  const gear = has('stickers') ? `url(#${g}st)` : helm;

  // ---- behind the body
  let back = '';
  if (has('cape')) back += `<path d="M38 50 Q24 76 26 98 Q50 92 74 98 Q76 76 62 50 Z" fill="#c1121f" stroke="#7a0c14" stroke-width="1"/><path d="M32 70 Q50 66 68 70" stroke="#7a0c14" stroke-width=".6" fill="none" opacity=".6"/>`;
  if (js === 5) back += `<path d="M34 50 Q30 30 50 26 Q70 30 66 50 Z" fill="${dk(jk, 85)}"/>`;
  if (has('backpack')) back += `<rect x="31" y="50" width="38" height="30" rx="7" fill="${ac}" stroke="${dk(ac)}" stroke-width="1"/><rect x="34" y="55" width="5" height="18" rx="2" fill="${dk(ac, 80)}"/><rect x="61" y="55" width="5" height="18" rx="2" fill="${dk(ac, 80)}"/>`;

  // ---- skis / board, side view (flat drawing)
  const side = board
    ? `<rect x="20" y="99" width="60" height="6" rx="3" fill="${gear}" stroke="${dk(helm)}" stroke-width="1" transform="rotate(-4 50 102)"/>
       <rect x="36" y="97" width="11" height="4" rx="1.5" fill="#222" transform="rotate(-4 50 102)"/><rect x="53" y="96.2" width="11" height="4" rx="1.5" fill="#222" transform="rotate(-4 50 102)"/>`
    : `<path d="M24 106 L56 103" stroke="${gear}" stroke-width="3.2" stroke-linecap="round"/><path d="M44 103 L78 106" stroke="${gear}" stroke-width="3.2" stroke-linecap="round"/>
       <path d="M24 106 q-3 -0.5 -4 -3" stroke="${helm}" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M78 106 q3 -0.5 4 -3" stroke="${helm}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  // ---- skis / board seen from above (laid flat in the 3D viewer), 0 0 100 40
  const top = board
    ? `<rect x="6" y="11" width="88" height="18" rx="9" fill="${gear}" stroke="${dk(helm)}" stroke-width="1.2"/><rect x="28" y="12.5" width="9" height="15" rx="2" fill="#222"/><rect x="63" y="12.5" width="9" height="15" rx="2" fill="#222"/>`
    : `<rect x="3" y="9" width="94" height="6" rx="3" fill="${gear}" stroke="${dk(helm)}" stroke-width="1"/><rect x="3" y="25" width="94" height="6" rx="3" fill="${gear}" stroke="${dk(helm)}" stroke-width="1"/>
       <rect x="44" y="8" width="12" height="8" rx="2" fill="#222"/><rect x="44" y="24" width="12" height="8" rx="2" fill="#222"/>`;

  // ---- legs
  const baggy = a.pantsStyle === 2;
  let legs = `<path d="M41 80 L${baggy ? 36 : 39} 100 L47 100 L49 82 Z M59 80 L${baggy ? 64 : 61} 100 L53 100 L51 82 Z" fill="${pt}" stroke="${dk(pt)}" stroke-width=".8"/>`;
  if (!board) legs += `<rect x="36" y="98" width="12" height="5" rx="2" fill="#222"/><rect x="52" y="98" width="12" height="5" rx="2" fill="#222"/>`;
  if (a.pantsStyle === 3) legs += `<path d="M40 80 L60 80 L61 89 L52 89 L50 85 L48 89 L39 89 Z" fill="#7aa7d6" stroke="#4f7cac" stroke-width=".8"/><path d="M40 88.5 l1 -1 M44 88.5 l1 -1 M56 88.5 l1 -1" stroke="#fff" stroke-width=".6"/>`;
  if (has('tutu')) legs += `<path d="M34 80 Q38 74 42 80 Q46 74 50 80 Q54 74 58 80 Q62 74 66 80 Q62 88 50 87 Q38 88 34 80 Z" fill="#ffafcc" stroke="#ff7ab6" stroke-width=".8" opacity=".95"/>`;

  // ---- torso
  const puffy = js === 1;
  const torso = `M${puffy ? 34 : 36} 50 Q50 45 ${puffy ? 66 : 64} 50 L${puffy ? 64 : 62} 82 L${puffy ? 36 : 38} 82 Z`;
  let body = `<path d="${torso}" fill="${js === 4 ? `url(#${g}pl)` : jk}" stroke="${dk(jk)}" stroke-width="1"/>`;
  if (js === 0 || js === 5) body += `<path d="M50 49 L50 82" stroke="${dk(jk)}" stroke-width="1"/><rect x="37" y="72" width="26" height="3" fill="${dk(jk)}" opacity=".5"/>`;
  if (puffy) body += `<path d="M35 58 Q50 61 65 58 M35 66 Q50 69 65 66 M36 74 Q50 77 64 74" stroke="${dk(jk, 80)}" stroke-width="1.2" fill="none"/>`;
  if (js === 2) body += `<rect x="37" y="76" width="26" height="4" fill="${ac}"/><rect x="48" y="76" width="4" height="4" fill="#ddd"/>`;
  if (js === 3) body += `<path d="M37 62 L63 52 L63 62 L37 72 Z" fill="${ac}"/><path d="M37 72 L63 62 L63 66 L37 76 Z" fill="#00e5ff"/>`;
  if (js === 5) body += `<path d="M46 50 L45 60 M54 50 L55 60" stroke="#fff" stroke-width="1" stroke-linecap="round"/><rect x="41" y="66" width="18" height="7" rx="2" fill="${dk(jk, 85)}"/>`;
  if (js === 6) body += `<path d="M42 50 L42 82 M58 50 L58 82" stroke="${dk(jk)}" stroke-width=".8"/>`;
  if (a.pantsStyle === 1) body += `<path d="M43 82 L43 58 L57 58 L57 82" fill="${pt}" stroke="${dk(pt)}" stroke-width=".8"/><path d="M43 58 L40 49 M57 58 L60 49" stroke="${pt}" stroke-width="2.4"/>`;
  if (has('backpack')) body += `<path d="M40 50 L40 74 M60 50 L60 74" stroke="${dk(ac)}" stroke-width="2.4"/>`;
  if (has('lanyard')) body += `<path d="M44 50 L50 64 L56 50" stroke="#2a9df4" stroke-width=".9" fill="none"/><rect x="46.5" y="63" width="7" height="9" rx="1" fill="#fff" stroke="#999" stroke-width=".5"/><rect x="47.5" y="64.5" width="5" height="2" fill="#e63946"/>`;
  if (has('fanny')) body += `<rect x="40" y="77" width="20" height="7" rx="3.5" fill="${ac}" stroke="${dk(ac)}" stroke-width=".8"/><path d="M42 80.5 L58 80.5" stroke="${dk(ac)}" stroke-width=".6"/>`;

  // ---- arms, gloves, poles
  const sleeve = js === 6 ? ac : jk, aw = puffy ? 9 : 7;
  let arms;
  if (board) {
    arms = `<path d="M36 55 Q24 60 20 70" stroke="${sleeve}" stroke-width="${aw}" fill="none" stroke-linecap="round"/><path d="M64 55 Q76 60 80 70" stroke="${sleeve}" stroke-width="${aw}" fill="none" stroke-linecap="round"/>
      <circle cx="20" cy="71" r="3.8" fill="${gl}" stroke="${dk(gl)}" stroke-width=".6"/><circle cx="80" cy="71" r="3.8" fill="${gl}" stroke="${dk(gl)}" stroke-width=".6"/>`;
  } else {
    arms = `<path d="M30 64 L22 101" stroke="#bbb" stroke-width="1.6" stroke-linecap="round"/><circle cx="22.6" cy="98" r="2.4" fill="none" stroke="#999" stroke-width="1"/>
      ${has('selfie') ? '' : `<path d="M70 64 L78 101" stroke="#bbb" stroke-width="1.6" stroke-linecap="round"/><circle cx="77.4" cy="98" r="2.4" fill="none" stroke="#999" stroke-width="1"/>`}
      <path d="M36 55 Q28 60 30 65" stroke="${sleeve}" stroke-width="${aw}" fill="none" stroke-linecap="round"/><path d="M64 55 Q72 60 70 65" stroke="${sleeve}" stroke-width="${aw}" fill="none" stroke-linecap="round"/>
      <circle cx="30" cy="65" r="3.8" fill="${gl}" stroke="${dk(gl)}" stroke-width=".6"/><circle cx="70" cy="65" r="3.8" fill="${gl}" stroke="${dk(gl)}" stroke-width=".6"/>`;
  }
  if (has('selfie')) { const [hx, hy] = board ? [80, 71] : [70, 65]; arms += `<path d="M${hx} ${hy} L${hx + 12} ${hy - 40}" stroke="#333" stroke-width="1.8" stroke-linecap="round"/><rect x="${hx + 8}" y="${hy - 48}" width="8" height="12" rx="1.5" fill="#111" transform="rotate(16 ${hx + 12} ${hy - 42})"/><circle cx="${hx + 12}" cy="${hy - 44}" r="1.4" fill="#4cc9f0"/>`; }

  // ---- head (face centred at 50,35)
  let head = '';
  if (has('antlers')) head += `<path d="M38 22 L32 10 M35 16 L29 15 M34 13 L36 7 M62 22 L68 10 M65 16 L71 15 M66 13 L64 7" stroke="#8d5a2b" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
  if (has('ears')) head += `<circle cx="35" cy="17" r="5.5" fill="${helm}" stroke="${dk(helm)}" stroke-width="1"/><circle cx="35" cy="17" r="2.6" fill="#ffb3c6"/><circle cx="65" cy="17" r="5.5" fill="${helm}" stroke="${dk(helm)}" stroke-width="1"/><circle cx="65" cy="17" r="2.6" fill="#ffb3c6"/>`;
  if (hs === 4) head += `<path d="M37 26 Q26 22 27 10 Q31 19 39 21 Z M63 26 Q74 22 73 10 Q69 19 61 21 Z" fill="#f1e3c6" stroke="#b9a37a" stroke-width=".8"/>`;
  if (hs === 7) head += `<path d="M47 19 Q52 4 58 3 Q55 11 56 19 Z" fill="${helm}" stroke="${dk(helm)}" stroke-width="1"/>`;
  if (has('mohawk')) head += `<path d="M39 21 l2.5 -8 l3 7 l3 -9 l2.5 9 l2.5 -9 l3 9 l3 -7 l2.5 8 z" fill="#ff3d7f" stroke="#c9184a" stroke-width=".6"/>`;
  head += `<ellipse cx="50" cy="35" rx="13" ry="12.5" fill="${skin}"/>`;
  if (has('cheeks')) head += `<circle cx="41" cy="40" r="2.6" fill="#ff8fab" opacity=".55"/><circle cx="59" cy="40" r="2.6" fill="#ff8fab" opacity=".55"/>`;
  if (hs === 3) { // beanie
    head += `<path d="M36 31 C36 14 64 14 64 31 Z" fill="${helm}"/><path d="M40 20 L40 28 M45 17.5 L45 28 M50 16.8 L50 28 M55 17.5 L55 28 M60 20 L60 28" stroke="${dk(helm, 85)}" stroke-width="1"/>
      <rect x="35" y="26" width="30" height="6" rx="3" fill="${dk(helm, 85)}"/>`;
  } else if (hs === 5) { // cowboy hat
    head += `<path d="M40 25 Q40 12 50 12 Q60 12 60 25 Z" fill="#a0522d" stroke="#6b3a1f" stroke-width="1"/><path d="M45 13 Q50 17 55 13" stroke="#6b3a1f" stroke-width="1" fill="none"/>
      <ellipse cx="50" cy="26" rx="21" ry="4" fill="#b5652f" stroke="#6b3a1f" stroke-width="1"/><rect x="40" y="22" width="20" height="2.6" fill="${ac}"/>`;
  } else {
    const half = hs === 1;
    head += half
      ? `<path d="M36 30 C36 13 64 13 64 30 Z" fill="${helm}" stroke="${dk(helm)}" stroke-width="1"/><rect x="35" y="28" width="30" height="3" rx="1.5" fill="${dk(helm, 80)}"/>`
      : `<path d="M35 31 C35 15 65 15 65 31 L65 33 L35 33 Z" fill="${helm}" stroke="${dk(helm)}" stroke-width="1"/><path d="M40 19 C46 16 55 16 60 19" stroke="#fff" stroke-opacity=".45" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    if (hs === 6) head += `<path d="M47 16.5 L47 31 M53 16.5 L53 31" stroke="${ac}" stroke-width="3"/>`;
    if (!half) head += `<path d="M44 18.5 l2 0 M49 17.6 l2 0 M54 18.5 l2 0" stroke="${dk(helm, 60)}" stroke-width="1.2" stroke-linecap="round"/>`;
  }
  if (has('pompom') && hs !== 5) head += `<circle cx="50" cy="${hs === 3 ? 14 : 16.5}" r="5" fill="#fff"/><circle cx="48" cy="${hs === 3 ? 13 : 15.5}" r="1.6" fill="#e9ecef"/><circle cx="52.5" cy="${hs === 3 ? 15 : 17.5}" r="1.4" fill="#dee2e6"/>`;
  if (has('gopro')) head += `<rect x="46" y="${hs === 5 ? 9 : 14.5}" width="8" height="6" rx="1.2" fill="#222"/><circle cx="50" cy="${hs === 5 ? 12 : 17.5}" r="1.8" fill="#4cc9f0"/>`;
  const eyes = `<circle cx="45" cy="34" r="1.5" fill="#222"/><circle cx="55" cy="34" r="1.5" fill="#222"/>`;
  if (ew === 0) head += `<rect x="35.5" y="28.5" width="29" height="10" rx="5" fill="#111"/><rect x="37" y="29.6" width="26" height="7.8" rx="3.9" fill="url(#${g}l)"/><path d="M40 31 L45 31 L42 36 Z" fill="#fff" fill-opacity=".55"/>`;
  else if (ew === 1) head += `<rect x="34" y="27" width="32" height="12.5" rx="6.2" fill="url(#${g}l)" stroke="#111" stroke-width="1"/><path d="M38 29.5 L45 29.5 L40 37 Z" fill="#fff" fill-opacity=".5"/>`;
  else if (ew === 2) head += `${eyes}<circle cx="44.5" cy="34" r="4.4" fill="url(#${g}l)" stroke="#111" stroke-width="1"/><circle cx="55.5" cy="34" r="4.4" fill="url(#${g}l)" stroke="#111" stroke-width="1"/><path d="M48.9 33.4 Q50 32.4 51.1 33.4" stroke="#111" stroke-width="1" fill="none"/>`;
  else if (ew === 3) head += `${eyes}<rect x="36.5" y="${hs === 5 ? 15 : 20}" width="27" height="7" rx="3.5" fill="#111"/><rect x="38" y="${hs === 5 ? 16 : 21}" width="24" height="5" rx="2.5" fill="url(#${g}l)"/>`;
  else head += eyes + `<path d="M42 30.5 l5 -.6 M53 29.9 l5 .6" stroke="${dk(skin, 50)}" stroke-width="1" stroke-linecap="round"/>`;
  head += `<path d="M44 43 Q50 47 56 43" stroke="${dk(skin)}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  if (has('beard')) head += `<path d="M38 39 Q38 52 50 53 Q62 52 62 39 Q57 44 50 44 Q43 44 38 39 Z" fill="#6b4226"/><path d="M45 44 Q50 46.5 55 44" stroke="#3b2414" stroke-width="1.2" fill="none"/>`;
  if (has('stache')) head += `<path d="M42 41.5 Q46 39 50 41 Q54 39 58 41.5 Q55 43.5 50 42.6 Q45 43.5 42 41.5 Z" fill="#4a2c17"/>`;
  if (hs === 2) head += `<path d="M36 33 L36 41 Q38 50 50 50 Q62 50 64 41 L64 33 L61 33 L61 40 Q59 46 50 46 Q41 46 39 40 L39 33 Z" fill="${helm}" stroke="${dk(helm)}" stroke-width="1"/><path d="M46 47.5 l8 0" stroke="${dk(helm, 60)}" stroke-width="1.2"/>`;
  if (has('gaiter')) head += `<path d="M37 42 Q50 46 63 42 L62 51 Q50 54 38 51 Z" fill="${ac}" stroke="${dk(ac)}" stroke-width=".8"/><path d="M39 46 Q50 49 61 46" stroke="${dk(ac, 80)}" stroke-width=".6" fill="none"/>`;
  if (has('scarf')) head += `<path d="M37 47 Q50 52 63 47 L63 52 Q50 57 37 52 Z" fill="${ac}"/><path d="M58 51 L62 66 L56 66 L54 52 Z" fill="${ac}" stroke="${dk(ac)}" stroke-width=".6"/><path d="M57 63 L62 63" stroke="${dk(ac)}" stroke-width=".8"/>`;
  if (has('lei')) head += [36, 41, 46, 50, 54, 59, 64].map((x, i) => `<circle cx="${x}" cy="${(49 + Math.sin(i / 6 * Math.PI) * 3).toFixed(1)}" r="2.4" fill="${['#ff3d7f', '#ffd23f', '#ff8c00', '#f72585', '#ffd23f', '#ff3d7f', '#ff8c00'][i]}"/>`).join('');
  if (has('parrot')) head += `<g transform="translate(66 40)"><ellipse cx="2" cy="6" rx="4.5" ry="6.5" fill="#22c55e"/><circle cx="2" cy="-1" r="3.6" fill="#e63946"/><path d="M5 -1.5 l3.5 1.2 l-3.2 1.6 z" fill="#ffd23f"/><circle cx="3" cy="-2" r=".8" fill="#111"/><path d="M0 11 l-1.5 5 M3 11 l1.5 5" stroke="#2a9df4" stroke-width="1.6"/></g>`;

  return { defs, back, side, top, legs, body, arms, head, board };
}

/** SVG of the rider. mode 'full' = whole body on gear, 'badge' = head & shoulders in a circle (map pins, lists). */
export function avatarSvg(a, { size = 120, mode = 'full', cls = '' } = {}) {
  const L = avatarLayers(a), o = normAv(a), jk = AV.color[o.jacket];
  if (mode === 'badge') {
    const id = `b${++uid}`;
    return `<svg class="av ${cls}" viewBox="22 4 56 56" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${L.defs}
      <clipPath id="${id}"><circle cx="50" cy="32" r="28"/></clipPath>
      <circle cx="50" cy="32" r="28" fill="#cfe8ff"/>
      <g clip-path="url(#${id})">${L.back}<path d="M28 70 Q28 48 50 48 Q72 48 72 70 Z" fill="${jk}"/>${L.head}</g>
      <circle cx="50" cy="32" r="27.2" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`;
  }
  return `<svg class="av ${cls}" viewBox="0 0 100 112" width="${size}" height="${size * 1.12}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${L.defs}
    <ellipse cx="50" cy="106" rx="34" ry="4" fill="#000" opacity=".18"/>${L.back}${L.side}${L.legs}${L.body}${L.arms}${L.head}</svg>`;
}

/** 3D rig markup: layers at different depths, skis/board laid flat. CSS (.av3d …) handles perspective + animation. */
export function avatar3d(a) {
  const L = avatarLayers(a), svg = (inner, vb = '0 0 100 112') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${L.defs}${inner}</svg>`;
  return `<div class="av3d-rig ${L.board ? 'board' : 'ski'}">
    <div class="av3d-shadow"></div>
    <div class="av3d-gear">${svg(L.top, '0 0 100 40')}</div>
    <div class="av3d-l back">${svg(L.back)}</div>
    <div class="av3d-l legs">${svg(L.legs)}</div>
    <div class="av3d-l body">${svg(L.body)}</div>
    <div class="av3d-l head">${svg(L.head)}</div>
    <div class="av3d-l arms">${svg(L.arms)}</div>
  </div>`;
}
