// Real-time 3D rider (three.js), modeled procedurally from smooth primitives:
// lathe-turned torso, swept tubes for limbs, capsules, spheres, extruded shapes and canvas textures.
// One WebGL context per viewer; call update(avatar) to rebuild the model, destroy() when done.
// Built into /vendor/rider3d.js by scripts/build-rider3d.sh (esbuild bundles + tree-shakes three).
import {
  Scene, PerspectiveCamera, WebGLRenderer, HemisphereLight, DirectionalLight, Group, Mesh, MeshStandardMaterial, MeshBasicMaterial,
  SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, CapsuleGeometry, LatheGeometry, TubeGeometry, ExtrudeGeometry, PlaneGeometry,
  Shape, Vector2, Vector3, CatmullRomCurve3, CanvasTexture, SRGBColorSpace, PCFSoftShadowMap, DoubleSide, Fog, Color, Points, BufferGeometry,
  Float32BufferAttribute, PointsMaterial, ACESFilmicToneMapping, RepeatWrapping,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const V = (x, y, z) => new Vector3(x, y, z);
const TAU = Math.PI * 2;

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** Build the rider model. o = normalized avatar, P = palette resolver. Returns { root, parts } for animation. */
function buildRider(o, P) {
  const disposables = [];
  const mat = (color, opts = {}) => { const m = new MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts }); disposables.push(m); return m; };
  const add = (parent, geo, m, pos, rot, scale) => {
    disposables.push(geo);
    const mesh = new Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true;
    if (pos) mesh.position.copy(pos); if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]); if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    parent.add(mesh); return mesh;
  };
  const has = (k) => o.acc.includes(k);
  const F = P.F, board = o.ride === 1;
  const skinM = mat(P.skin, { roughness: 0.55 });
  const helmM = mat(P.helm, { roughness: 0.3, metalness: 0.1 });
  const accM = mat(P.acc);
  const darkM = mat('#151515', { roughness: 0.5 });
  const pantsM = mat(P.pants, { roughness: 0.85 });
  const gloveM = mat(P.gloves, { roughness: 0.6 });
  const stickerTex = has('stickers') ? canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = P.helm; g.fillRect(0, 0, w, h);
    const cols = ['#ff3d7f', '#22c55e', '#ffd23f', '#4cc9f0', '#7b2ff7', '#fff', '#ff8c00'];
    for (let i = 0; i < 40; i++) { g.fillStyle = cols[i % cols.length]; g.save(); g.translate(Math.random() * w, Math.random() * h); g.rotate(Math.random() * 6);
      if (i % 3 === 0) { g.beginPath(); g.arc(0, 0, 10 + Math.random() * 14, 0, TAU); g.fill(); } else if (i % 3 === 1) g.fillRect(-14, -9, 28, 18); else { g.beginPath(); g.moveTo(0, -14); g.lineTo(13, 10); g.lineTo(-13, 10); g.fill(); }
      g.restore(); }
  }) : null;
  if (stickerTex) disposables.push(stickerTex);
  const gearM = stickerTex ? mat('#ffffff', { map: stickerTex, roughness: 0.35 }) : mat(P.helm, { roughness: 0.3, metalness: 0.15 });

  const root = new Group();      // user yaw
  const rig = new Group();       // whole-body animation (carve, ollie, tricks)
  const gear = new Group();      // skis / board
  const lower = new Group();     // legs (compress on turns)
  const upper = new Group();     // torso + head + arms, pivots at hips
  upper.position.y = 0.92;
  root.add(rig); rig.add(gear, lower, upper);

  // ---------- skis / board ----------
  if (board) {
    const s = new Shape(); const L = 0.78, W = 0.15, r = 0.15;
    s.moveTo(-L + r, -W); s.lineTo(L - r, -W); s.quadraticCurveTo(L, -W, L, 0); s.quadraticCurveTo(L, W, L - r, W); s.lineTo(-L + r, W); s.quadraticCurveTo(-L, W, -L, 0); s.quadraticCurveTo(-L, -W, -L + r, -W);
    const bg = new ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.01, bevelSegments: 3, curveSegments: 24 });
    add(gear, bg, gearM, V(0, 0.03, 0), [Math.PI / 2, 0, 0]);
    for (const x of [-0.24, 0.24]) add(gear, new RoundedBoxGeometry(0.15, 0.06, 0.22, 3, 0.02), darkM, V(x, 0.08, 0));
  } else {
    for (const x of [-0.11, 0.11]) {
      add(gear, new RoundedBoxGeometry(0.085, 0.025, 1.6, 2, 0.01), gearM, V(x, 0.03, 0.02));
      add(gear, new RoundedBoxGeometry(0.085, 0.025, 0.2, 2, 0.01), gearM, V(x, 0.075, 0.88), [-0.45, 0, 0]); // tip
      add(gear, new RoundedBoxGeometry(0.1, 0.05, 0.16, 2, 0.015), darkM, V(x, 0.06, 0.02)); // binding
    }
  }

  // ---------- legs ----------
  const legR = 0.062 * (0.85 + F * 0.15), baggy = o.pantsStyle === 2;
  const feetX = board ? 0.24 : 0.11;
  for (const side of [-1, 1]) {
    const hip = V(side * 0.09 * F, 0.93, 0), knee = V(side * (board ? 0.18 : 0.11), 0.5, 0.07), ankle = V(side * feetX, 0.14, 0);
    const curve = new CatmullRomCurve3([hip, knee, ankle]);
    add(lower, new TubeGeometry(curve, 24, baggy ? legR * 1.25 : legR, 16, false), pantsM);
    add(lower, new SphereGeometry(legR * (baggy ? 1.25 : 1), 16, 12), pantsM, hip);
    add(lower, new RoundedBoxGeometry(0.12, 0.16, 0.24, 3, 0.04), board ? mat('#2b2b2b') : mat('#1f1f1f', { roughness: 0.35 }), V(side * feetX, 0.12, 0.03));
    if (o.pantsStyle === 3) add(lower, new CylinderGeometry(legR * 1.45, legR * 1.6, 0.22, 20), mat('#7aa7d6', { roughness: 0.9 }), V(side * 0.1 * F, 0.8, 0.01), [0, 0, side * -0.05]);
  }
  if (has('tutu')) add(lower, new ConeGeometry(0.33 * F, 0.16, 40, 1, true), mat('#ffafcc', { side: DoubleSide, roughness: 0.9, transparent: true, opacity: 0.92 }), V(0, 0.88, 0));

  // ---------- torso (lathe-turned body, flattened front-to-back) ----------
  const belly = Math.max(0, (F - 1.05) * 0.1);
  const prof = [[0, -0.04], [0.13, -0.03], [0.155, 0.04], [0.15 + belly * 0.6, 0.14], [0.16 + belly, 0.22], [0.175, 0.33], [0.18, 0.42], [0.16, 0.49], [0.07, 0.54], [0, 0.545]]
    .map(([r, y]) => new Vector2(r * (y < 0.5 ? F : 1), y));
  const sweater = has('sweater');
  const jacketTex = sweater ? canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#b5121b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 5;
    for (const y of [26, 102]) { g.beginPath(); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + (x / 16 % 2 ? -8 : 8)); g.stroke(); }
    g.fillStyle = '#2b9348'; for (let x = 16; x < w; x += 64) { g.beginPath(); g.moveTo(x, 78); g.lineTo(x + 14, 46); g.lineTo(x + 28, 78); g.fill(); g.fillStyle = '#ffd23f'; g.fillRect(x + 12, 40, 5, 5); g.fillStyle = '#2b9348'; }
  }) : o.jacketStyle === 4 ? canvasTex(64, 64, (g) => {
    g.fillStyle = P.jacket; g.fillRect(0, 0, 64, 64); g.globalAlpha = 0.55; g.fillStyle = P.acc; g.fillRect(0, 0, 64, 20); g.fillRect(0, 0, 20, 64); g.globalAlpha = 0.25; g.fillStyle = '#000'; g.fillRect(44, 0, 4, 64); g.fillRect(0, 44, 64, 4);
  }, [6, 3]) : o.jacketStyle === 3 ? canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = P.jacket; g.fillRect(0, 0, w, h); g.fillStyle = P.acc; g.fillRect(0, 48, w, 26); g.fillStyle = '#00e5ff'; g.fillRect(0, 76, w, 10);
  }) : null;
  if (jacketTex) disposables.push(jacketTex);
  const jacketM = mat(jacketTex ? '#ffffff' : P.jacket, { roughness: o.jacketStyle === 0 ? 0.45 : 0.8, map: jacketTex });
  const torso = add(upper, new LatheGeometry(prof, 48), jacketM, V(0, 0, 0), null, [1, 1, 0.74 + F * 0.06]);
  if (o.jacketStyle === 1) for (const y of [0.12, 0.24, 0.36]) add(upper, new TorusGeometry(0.166 * F + (y < 0.2 ? belly : 0), 0.014, 10, 48), jacketM, V(0, y, 0), [Math.PI / 2, 0, 0], [1, 0.76 + F * 0.06, 1]);
  if (o.jacketStyle === 0 || o.jacketStyle === 5) add(upper, new CylinderGeometry(0.004, 0.004, 0.46, 6), darkM, V(0, 0.27, 0.142 * (0.74 + F * 0.06) * (1 + belly * 2)));
  if (o.jacketStyle === 2) add(upper, new TorusGeometry(0.153 * F, 0.02, 10, 48), accM, V(0, 0.02, 0), [Math.PI / 2, 0, 0], [1, 0.76 + F * 0.06, 1]);
  if (o.jacketStyle === 5) add(upper, new TorusGeometry(0.1, 0.045, 14, 32), mat(P.jacket, { roughness: 0.85 }), V(0, 0.52, -0.06), [0.4, 0, 0]);
  if (o.pantsStyle === 1) for (const s of [-1, 1]) add(upper, new CylinderGeometry(0.012, 0.012, 0.5, 6), pantsM, V(s * 0.08, 0.27, 0.14 * F), [0.05, 0, s * 0.1]);
  const neck = 0.545;

  // ---------- arms (swept tubes), gloves, poles ----------
  const sleeveM = o.jacketStyle === 6 ? accM : (sweater ? mat('#b5121b', { roughness: 0.85 }) : mat(P.jacket, { roughness: 0.8 }));
  const armR = (o.jacketStyle === 1 ? 0.058 : 0.048) * (0.85 + F * 0.15), shX = 0.19 * (0.9 + F * 0.1);
  const arms = [];
  for (const side of [-1, 1]) {
    const g = new Group(); g.position.set(side * shX, 0.44, 0); upper.add(g); arms.push(g);
    const elbow = board ? V(side * 0.17, -0.2, 0.02) : V(side * 0.07, -0.25, 0.12);
    const hand = board ? V(side * 0.3, -0.36, 0.06) : V(side * 0.1, -0.42, 0.26);
    add(g, new TubeGeometry(new CatmullRomCurve3([V(0, 0, 0), elbow, hand]), 20, armR, 14, false), sleeveM);
    add(g, new SphereGeometry(armR * 1.05, 14, 10), sleeveM);
    add(g, new SphereGeometry(0.048, 16, 12), gloveM, hand, null, [1, 1.1, 1.15]);
    g.userData.hand = hand;
    if (!board && !(has('selfie') && side === 1)) {
      const tip = V(side * 0.12, -1.34, 0.05);
      const dir = tip.clone().sub(hand), len = dir.length();
      const pole = add(g, new CylinderGeometry(0.009, 0.009, len, 8), mat('#c9c9c9', { metalness: 0.7, roughness: 0.3 }), hand.clone().add(tip).multiplyScalar(0.5));
      pole.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
      add(g, new TorusGeometry(0.035, 0.006, 6, 20), darkM, tip.clone().add(V(0, 0.06, 0)), [Math.PI / 2, 0, 0]);
    }
  }
  const handOf = (side) => { const g = arms[side < 0 ? 0 : 1]; return { g, p: g.userData.hand }; };
  if (has('selfie')) { const { g, p } = handOf(1); add(g, new CylinderGeometry(0.008, 0.008, 0.6, 8), darkM, p.clone().add(V(0.06, 0.28, 0)), [0, 0, -0.2]); add(g, new RoundedBoxGeometry(0.07, 0.13, 0.012, 2, 0.008), darkM, p.clone().add(V(0.12, 0.6, 0)), [0, -0.4, -0.2]); }
  if (has('drumstick')) { const { g, p } = handOf(-1); add(g, new SphereGeometry(0.06, 16, 12), mat('#b5651d', { roughness: 0.5 }), p.clone().add(V(0, 0.09, 0.02)), null, [1, 1.3, 1]); add(g, new CylinderGeometry(0.012, 0.012, 0.08, 8), mat('#f5f0e1'), p.clone().add(V(0, -0.02, 0.02))); }
  if (has('sparkler')) { const { g, p } = handOf(-1); add(g, new CylinderGeometry(0.004, 0.004, 0.34, 6), mat('#888', { metalness: 0.6 }), p.clone().add(V(-0.05, 0.16, 0.03)), [0, 0, 0.3]);
    const sp = add(g, new SphereGeometry(0.035, 10, 8), new MeshBasicMaterial({ color: '#fff6b0' }), p.clone().add(V(-0.1, 0.33, 0.03))); sp.userData.spark = true; }
  if (has('basket')) { const { g, p } = handOf(-1); add(g, new CylinderGeometry(0.08, 0.06, 0.08, 20), mat('#d4a373'), p.clone().add(V(0, -0.08, 0))); add(g, new TorusGeometry(0.075, 0.007, 6, 24, Math.PI), mat('#a0522d'), p.clone().add(V(0, -0.05, 0)));
    ['#ffafcc', '#a2d2ff', '#ffd23f'].forEach((c, i) => add(g, new SphereGeometry(0.028, 12, 10), mat(c), p.clone().add(V(-0.035 + i * 0.035, -0.03, 0)), null, [1, 1.3, 1])); }
  if (has('balloon')) { const { g, p } = handOf(-1); add(g, new CylinderGeometry(0.002, 0.002, 0.7, 4), mat('#aaa'), p.clone().add(V(0, 0.35, 0))); const b = add(g, new SphereGeometry(0.11, 24, 18), mat('#ff3d7f', { roughness: 0.2 }), p.clone().add(V(0, 0.8, 0)), null, [1, 1.2, 1]); b.userData.bob = true; }

  // ---------- head ----------
  const head = new Group(); head.position.y = neck + 0.2; head.scale.setScalar(1.28); upper.add(head); // slightly big head = friendlier character
  add(upper, new CylinderGeometry(0.052, 0.058, 0.1, 16), skinM, V(0, neck + 0.04, 0));
  const hr = 0.135 * (1 + (F - 1) * 0.15);
  add(head, new SphereGeometry(0.135, 40, 30), skinM, null, null, [hr / 0.135, 1.02, 1]);
  add(head, new SphereGeometry(0.018, 12, 10), skinM, V(0, -0.015, 0.135)); // nose
  for (const s of [-1, 1]) add(head, new SphereGeometry(0.026, 12, 10), skinM, V(s * hr * 0.98, -0.005, 0), null, [0.6, 1, 1]); // ears
  add(head, new TorusGeometry(0.036, 0.007, 8, 20, Math.PI), mat('#7a3b2e'), V(0, -0.06, 0.122), [0.25, 0, Math.PI]); // smile
  if (has('cheeks')) for (const s of [-1, 1]) add(head, new SphereGeometry(0.025, 12, 10), mat('#ff8fab', { transparent: true, opacity: 0.55 }), V(s * 0.075, -0.035, 0.108), null, [1, 0.7, 0.4]);
  const ew = o.eyewear;
  if (ew >= 2) for (const s of [-1, 1]) add(head, new SphereGeometry(0.014, 12, 10), darkM, V(s * 0.045, 0.012, 0.125));
  const lensM = mat(P.lens1, { roughness: 0.08, metalness: 0.75, emissive: new Color(P.lens2), emissiveIntensity: 0.25 });
  const goggles = (y, r, h, wide) => {
    add(head, new CylinderGeometry(r, r, h * 1.25, 40, 1, true, -wide / 2 - 0.08, wide + 0.16), mat('#111', { side: DoubleSide, roughness: 0.4 }), V(0, y, 0));
    add(head, new CylinderGeometry(r + 0.006, r + 0.006, h, 40, 1, true, -wide / 2, wide), Object.assign(lensM, { side: DoubleSide }), V(0, y, 0));
    add(head, new TorusGeometry(r - 0.004, 0.009, 8, 48), darkM, V(0, y, 0), [Math.PI / 2, 0, 0]);
  };
  // hats (props) replace the helmet
  const hatProp = ['santa', 'pilgrim', 'leprechaun', 'unclesam', 'witchhat', 'partyhat'].find(has);
  const hs = o.helmStyle;
  const topY = 0.0;
  if (!hatProp) {
    if (hs === 3) { // beanie
      add(head, new SphereGeometry(0.143, 36, 20, 0, TAU, 0, Math.PI * 0.5), mat(P.helm, { roughness: 0.95 }), V(0, 0.02, 0), [-0.12, 0, 0]);
      add(head, new TorusGeometry(0.14, 0.022, 12, 40), mat(P.helm, { roughness: 0.95 }), V(0, 0.03, -0.01), [Math.PI / 2 - 0.12, 0, 0]);
    } else if (hs === 5) { // cowboy
      add(head, new CylinderGeometry(0.28, 0.28, 0.012, 40), mat('#a0522d', { roughness: 0.8 }), V(0, 0.075, 0), [-0.08, 0, 0]);
      add(head, new CylinderGeometry(0.11, 0.13, 0.15, 30), mat('#8b4513', { roughness: 0.8 }), V(0, 0.15, -0.01), [-0.08, 0, 0]);
      add(head, new CylinderGeometry(0.131, 0.131, 0.025, 30), accM, V(0, 0.09, -0.005), [-0.08, 0, 0]);
    } else {
      const half = hs === 1;
      add(head, new SphereGeometry(0.152, 40, 24, 0, TAU, 0, Math.PI * (half ? 0.46 : 0.55)), helmM, V(0, 0.015, -0.008), [-0.18, 0, 0]);
      if (!half) for (const s of [-1, 1]) add(head, new SphereGeometry(0.05, 16, 12), helmM, V(s * 0.138, -0.02, -0.01), null, [0.5, 1.1, 1.1]);
      if (half) add(head, new TorusGeometry(0.148, 0.01, 8, 48), mat(P.helm, { roughness: 0.6 }), V(0, 0.035, -0.02), [Math.PI / 2 - 0.18, 0, 0]);
      else for (const x of [-0.04, 0, 0.04]) add(head, new RoundedBoxGeometry(0.018, 0.012, 0.06, 2, 0.005), darkM, V(x, 0.15, -0.01), [-0.3, 0, 0]);
      if (hs === 6) add(head, new TorusGeometry(0.152, 0.018, 8, 40, Math.PI), accM, V(0, 0.015, -0.008), [0, Math.PI / 2, Math.PI / 2 - 0.18]);
      if (hs === 2) add(head, new TorusGeometry(0.12, 0.028, 12, 32, Math.PI), helmM, V(0, -0.07, 0.03), [0.35, 0, Math.PI]);
      if (hs === 4) for (const s of [-1, 1]) add(head, new TubeGeometry(new CatmullRomCurve3([V(s * 0.13, 0.06, 0), V(s * 0.24, 0.1, 0), V(s * 0.27, 0.24, 0)]), 16, 0.026, 10), mat('#f1e3c6', { roughness: 0.5 }), null);
      if (hs === 7) { const fs = new Shape(); fs.moveTo(-0.06, 0); fs.quadraticCurveTo(0.02, 0.06, 0.04, 0.16); fs.quadraticCurveTo(0.04, 0.07, 0.07, 0); fs.lineTo(-0.06, 0);
        add(head, new ExtrudeGeometry(fs, { depth: 0.014, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }), helmM, V(-0.007, 0.13, -0.02), [0, Math.PI / 2, 0]); }
    }
  }
  if (ew === 0) goggles(0.02, 0.146, 0.06, 1.9);
  else if (ew === 1) goggles(0.02, 0.15, 0.085, 2.2);
  else if (ew === 2) for (const s of [-1, 1]) { add(head, new CylinderGeometry(0.03, 0.03, 0.008, 24), lensM, V(s * 0.045, 0.012, 0.137), [Math.PI / 2, 0, 0]); add(head, new TorusGeometry(0.03, 0.004, 6, 24), darkM, V(s * 0.045, 0.012, 0.139)); }
  else if (ew === 3) goggles(hatProp ? 0.09 : 0.1, 0.153, 0.05, 1.7);
  // helmet/hat add-ons
  const crown = hs === 5 ? 0.24 : 0.17;
  if (has('pompom') && !hatProp) add(head, new SphereGeometry(0.045, 16, 12), mat('#fff', { roughness: 1 }), V(0, crown, -0.02));
  if (has('mohawk')) for (let i = 0; i < 6; i++) { const a = -0.5 + i * 0.22; add(head, new ConeGeometry(0.02, 0.09, 10), mat('#ff3d7f', { roughness: 0.5 }), V(0, 0.15 * Math.cos(a) + 0.04, 0.15 * Math.sin(a) - 0.03), [a, 0, 0]); }
  if (has('ears')) for (const s of [-1, 1]) { add(head, new SphereGeometry(0.04, 16, 12), helmM, V(s * 0.1, 0.13, -0.02), null, [1, 1, 0.6]); add(head, new SphereGeometry(0.022, 12, 10), mat('#ffb3c6'), V(s * 0.1, 0.13, 0.002), null, [1, 1, 0.4]); }
  if (has('antlers')) for (const s of [-1, 1]) { const am = mat('#8d5a2b', { roughness: 0.7 });
    add(head, new TubeGeometry(new CatmullRomCurve3([V(s * 0.08, 0.12, -0.02), V(s * 0.15, 0.25, -0.03), V(s * 0.22, 0.35, -0.02)]), 12, 0.013, 8), am);
    add(head, new TubeGeometry(new CatmullRomCurve3([V(s * 0.15, 0.25, -0.03), V(s * 0.1, 0.33, -0.01)]), 6, 0.01, 8), am); }
  if (has('gopro')) { add(head, new RoundedBoxGeometry(0.06, 0.045, 0.05, 2, 0.008), darkM, V(0, crown - 0.01, 0.02)); add(head, new CylinderGeometry(0.014, 0.014, 0.01, 16), mat('#4cc9f0', { metalness: 0.6, roughness: 0.1 }), V(0, crown - 0.01, 0.047), [Math.PI / 2, 0, 0]); }
  if (has('beard')) add(head, new SphereGeometry(0.128, 32, 20, 0, TAU, Math.PI * 0.55, Math.PI * 0.45), mat('#6b4226', { roughness: 1 }), V(0, -0.005, 0.012), [0.15, 0, 0]);
  if (has('stache')) for (const s of [-1, 1]) add(head, new CapsuleGeometry(0.012, 0.035, 4, 8), mat('#4a2c17', { roughness: 1 }), V(s * 0.022, -0.04, 0.13), [0, 0, s * 1.3]);
  if (has('gaiter') || has('flag')) {
    const gt = has('flag') ? canvasTex(128, 64, (g, w, h) => { for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#fff' : '#c1121f'; g.fillRect(0, i * h / 7, w, h / 7 + 1); } g.fillStyle = '#1d3557'; g.fillRect(0, 0, w * 0.4, h * 0.55); }) : null;
    if (gt) disposables.push(gt);
    add(head, new CylinderGeometry(0.128, 0.12, 0.11, 36, 1, true), mat(gt ? '#fff' : P.acc, { map: gt, side: DoubleSide, roughness: 0.95 }), V(0, -0.08, 0.008));
  }
  if (has('scarf')) { add(upper, new TorusGeometry(0.085, 0.03, 12, 32), accM, V(0, neck + 0.01, 0.01), [Math.PI / 2, 0, 0]); add(upper, new RoundedBoxGeometry(0.06, 0.2, 0.025, 2, 0.01), accM, V(0.06, neck - 0.1, 0.12), [0.2, 0, 0.12]); }
  if (has('lei') || has('beads')) { const cols = has('lei') ? ['#ff3d7f', '#ffd23f', '#ff8c00', '#f72585'] : ['#7b2ff7', '#22c55e', '#ffd23f'];
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; add(upper, new SphereGeometry(has('lei') ? 0.025 : 0.014, 10, 8), mat(cols[i % cols.length], { roughness: has('beads') ? 0.15 : 0.8, metalness: has('beads') ? 0.4 : 0 }), V(Math.sin(a) * 0.12, neck - 0.04 - (Math.cos(a) > 0 ? Math.cos(a) * (has('beads') ? 0.12 : 0.05) : 0), Math.cos(a) * 0.115 * (0.8 + F * 0.1))); } }
  if (has('lanyard')) { add(upper, new TorusGeometry(0.11, 0.004, 6, 32, Math.PI), mat('#2a9df4'), V(0, neck - 0.02, 0.07), [-1.2, 0, Math.PI]); add(upper, new RoundedBoxGeometry(0.06, 0.08, 0.008, 2, 0.006), mat('#fff', { roughness: 0.3 }), V(0, neck - 0.17, 0.155 * (0.74 + F * 0.06) * F + 0.01)); }
  if (has('fanny')) add(upper, new CapsuleGeometry(0.04, 0.15, 6, 12), accM, V(0, 0.04, 0.15 * F * (0.74 + F * 0.06) + 0.03), [0, 0, Math.PI / 2]);
  if (has('backpack')) { add(upper, new RoundedBoxGeometry(0.3, 0.36, 0.14, 4, 0.05), accM, V(0, 0.27, -0.14 * (0.74 + F * 0.06) * F - 0.06)); for (const s of [-1, 1]) add(upper, new TorusGeometry(0.15, 0.012, 6, 24, Math.PI), mat(P.acc), V(s * 0.1, 0.33, 0), [0, Math.PI / 2, 0], [1, 1, 0.74 + F * 0.06]); }
  if (has('cape')) { const cape = add(upper, new CylinderGeometry(0.17 * F, 0.36 * F, 0.85, 32, 8, true, Math.PI * 0.62, Math.PI * 0.76), mat('#c1121f', { side: DoubleSide, roughness: 0.6 }), V(0, 0.1, -0.02)); cape.userData.cape = true; }
  if (has('wings')) for (const s of [-1, 1]) { const ws = new Shape(); ws.moveTo(0, 0); ws.bezierCurveTo(0.12, 0.25, 0.32, 0.22, 0.34, 0.06); ws.bezierCurveTo(0.26, 0.04, 0.24, -0.06, 0.16, -0.12); ws.bezierCurveTo(0.08, -0.08, 0.04, -0.04, 0, 0);
    const w = add(upper, new ExtrudeGeometry(ws, { depth: 0.01, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2 }), mat('#fff', { roughness: 0.9 }), V(s * 0.05, 0.32, -0.16 * F), [0, s > 0 ? 0.5 : Math.PI - 0.5, 0]); w.userData.wing = s; }
  if (has('parrot') || has('groundhog')) { const p = new Group(); p.position.set(has('parrot') ? 0.17 * F : -0.17 * F, 0.5, -0.02); upper.add(p);
    if (has('parrot')) { add(p, new CapsuleGeometry(0.04, 0.07, 6, 12), mat('#22c55e'), V(0, 0.06, 0)); add(p, new SphereGeometry(0.035, 14, 12), mat('#e63946'), V(0, 0.14, 0.01)); add(p, new ConeGeometry(0.012, 0.035, 10), mat('#ffd23f'), V(0, 0.135, 0.05), [Math.PI / 2, 0, 0]);
      for (const s of [-1, 1]) add(p, new SphereGeometry(0.006, 8, 6), darkM, V(s * 0.018, 0.15, 0.035)); add(p, new ConeGeometry(0.02, 0.1, 10), mat('#2a9df4'), V(0, -0.02, -0.04), [-2.6, 0, 0]); }
    else { add(p, new CapsuleGeometry(0.045, 0.05, 6, 12), mat('#8d5a2b', { roughness: 1 }), V(0, 0.06, 0)); add(p, new SphereGeometry(0.04, 14, 12), mat('#9c6b3c', { roughness: 1 }), V(0, 0.14, 0.01)); for (const s of [-1, 1]) { add(p, new SphereGeometry(0.006, 8, 6), darkM, V(s * 0.016, 0.15, 0.045)); add(p, new SphereGeometry(0.012, 8, 6), mat('#7a4b22'), V(s * 0.03, 0.18, 0)); } }
    p.userData.buddy = true; }
  // holiday face bits
  if (has('heartglasses')) for (const s of [-1, 1]) { const hsh = new Shape(); hsh.moveTo(0, -0.03); hsh.bezierCurveTo(-0.05, 0, -0.03, 0.04, 0, 0.02); hsh.bezierCurveTo(0.03, 0.04, 0.05, 0, 0, -0.03);
    add(head, new ExtrudeGeometry(hsh, { depth: 0.008, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 2 }), mat('#ff3d7f', { roughness: 0.2 }), V(s * 0.047, 0.012, 0.135)); }
  if (has('nyglasses')) { const yr = String(new Date().getMonth() === 11 ? new Date().getFullYear() + 1 : new Date().getFullYear());
    const t = canvasTex(256, 96, (g, w, h) => { g.font = '900 84px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 8; g.strokeStyle = '#7a5b00'; g.strokeText(yr, w / 2, h / 2 + 4); g.fillStyle = '#ffd23f'; g.fillText(yr, w / 2, h / 2 + 4); }); disposables.push(t);
    add(head, new PlaneGeometry(0.24, 0.09), new MeshBasicMaterial({ map: t, transparent: true }), V(0, 0.015, 0.145)); }
  if (has('groucho')) { for (const s of [-1, 1]) { add(head, new TorusGeometry(0.03, 0.005, 8, 24), darkM, V(s * 0.045, 0.012, 0.137)); add(head, new CapsuleGeometry(0.008, 0.04, 4, 8), darkM, V(s * 0.045, 0.055, 0.13), [0, 0, Math.PI / 2 + s * 0.2]); add(head, new CapsuleGeometry(0.012, 0.035, 4, 8), darkM, V(s * 0.022, -0.045, 0.132), [0, 0, s * 1.3]); }
    add(head, new SphereGeometry(0.03, 16, 12), mat('#f4a6a6', { roughness: 0.4 }), V(0, -0.015, 0.145), null, [0.9, 1.1, 1]); }
  if (has('shamrock')) for (const [x, y] of [[0, 0.01], [-0.01, -0.004], [0.01, -0.004]]) add(head, new SphereGeometry(0.009, 8, 6), mat('#22c55e'), V(0.075 + x, -0.035 + y, 0.112), null, [1, 1, 0.4]);
  if (has('pumpkin')) { const pts = []; for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 + (i / 20) * Math.PI; pts.push(new Vector2(Math.cos(a) * 0.19, Math.sin(a) * 0.165)); }
    const pg = new LatheGeometry(pts, 48); const pos = pg.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x), k = 1 - 0.06 * Math.pow(Math.abs(Math.cos(a * 5)), 0.5); pos.setX(i, x * k); pos.setZ(i, z * k); }
    pg.computeVertexNormals();
    const face = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#ff8c00'; g.fillRect(0, 0, w, h); g.fillStyle = '#3b1d00'; g.beginPath(); g.moveTo(98, 50); g.lineTo(118, 30); g.lineTo(122, 56); g.fill(); g.beginPath(); g.moveTo(158, 50); g.lineTo(138, 30); g.lineTo(134, 56); g.fill();
      g.beginPath(); g.moveTo(96, 78); for (let x = 96; x <= 160; x += 8) g.lineTo(x, 78 + (x / 8 % 2 ? 8 : 0)); g.quadraticCurveTo(128, 120, 96, 78); g.fill(); }); disposables.push(face);
    face.offset.x = 0.25; add(head, pg, mat('#ffffff', { map: face, roughness: 0.55 }), V(0, 0.02, 0), [0, -Math.PI / 2, 0]);
    add(head, new CylinderGeometry(0.015, 0.02, 0.06, 10), mat('#2b9348'), V(0, 0.2, 0), [0.2, 0, 0.2]); }
  if (hatProp) {
    const hat = new Group(); hat.position.set(0, 0.07, -0.005); hat.rotation.x = -0.1; head.add(hat);
    if (hatProp === 'santa') { const sh = add(hat, new ConeGeometry(0.14, 0.3, 32, 6), mat('#d00000', { roughness: 0.9 }), V(0, 0.13, -0.02), [-0.5, 0, 0]); sh.position.z = -0.06;
      add(hat, new TorusGeometry(0.135, 0.035, 14, 36), mat('#fff', { roughness: 1 }), V(0, 0.0, 0), [Math.PI / 2, 0, 0]); add(hat, new SphereGeometry(0.04, 14, 10), mat('#fff', { roughness: 1 }), V(0, 0.2, -0.21)); }
    else if (hatProp === 'partyhat') { const pt = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#7b2ff7'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd23f'; for (let y = 10; y < h; y += 32) g.fillRect(0, y, w, 10); }); disposables.push(pt);
      add(hat, new ConeGeometry(0.09, 0.26, 32), mat('#fff', { map: pt, roughness: 0.5 }), V(0, 0.14, 0)); add(hat, new SphereGeometry(0.03, 12, 10), mat('#ff3d7f'), V(0, 0.28, 0)); }
    else if (hatProp === 'witchhat') { add(hat, new CylinderGeometry(0.27, 0.27, 0.012, 40), mat('#240046'), V(0, 0.02, 0)); const c = add(hat, new ConeGeometry(0.12, 0.38, 32, 6), mat('#3c096c', { roughness: 0.9 }), V(0, 0.2, -0.02), [-0.18, 0, 0.1]); add(hat, new CylinderGeometry(0.122, 0.13, 0.04, 32), mat('#ff8c00'), V(0, 0.045, 0)); }
    else { // top hats: pilgrim / leprechaun / uncle sam
      const col = hatProp === 'pilgrim' ? '#1d1d1f' : hatProp === 'leprechaun' ? '#1a7f37' : '#ffffff';
      const tm = hatProp === 'unclesam' ? (() => { const t = canvasTex(128, 128, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff' : '#d00000'; g.fillRect(0, i * h / 8, w, h / 8 + 1); } }); disposables.push(t); return mat('#fff', { map: t, roughness: 0.7 }); })() : mat(col, { roughness: 0.8 });
      add(hat, new CylinderGeometry(0.24, 0.24, 0.014, 40), hatProp === 'unclesam' ? mat('#1d3557') : mat(col, { roughness: 0.8 }), V(0, 0.02, 0));
      add(hat, new CylinderGeometry(hatProp === 'pilgrim' ? 0.11 : 0.12, 0.13, 0.24, 32), tm, V(0, 0.14, 0));
      add(hat, new CylinderGeometry(0.132, 0.132, 0.045, 32), hatProp === 'unclesam' ? mat('#1d3557') : darkM, V(0, 0.05, 0));
      if (hatProp !== 'unclesam') add(hat, new TorusGeometry(0.022, 0.006, 6, 4), mat(hatProp === 'pilgrim' ? '#e9c46a' : '#ffd23f', { metalness: 0.8, roughness: 0.3 }), V(0, 0.05, 0.134), [0, 0, Math.PI / 4]);
    }
    if (has('pompom') && hatProp !== 'santa') add(hat, new SphereGeometry(0.04, 14, 10), mat('#fff', { roughness: 1 }), V(0, hatProp === 'witchhat' ? 0.4 : 0.3, 0));
  }
  if (has('bunnyears')) for (const s of [-1, 1]) { add(head, new SphereGeometry(0.035, 16, 12), mat('#fff', { roughness: 1 }), V(s * 0.05, 0.27, -0.02), [0, 0, s * -0.2], [1, 3, 0.5]); add(head, new SphereGeometry(0.02, 12, 10), mat('#ffc8dd'), V(s * 0.05, 0.27, -0.004), [0, 0, s * -0.2], [1, 3, 0.3]); }
  if (has('lights')) { for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU * 1.6, y = 0.1 + (i / 22) * 0.32; const r = 0.17 * F + 0.012;
    const b = add(upper, new SphereGeometry(0.014, 10, 8), new MeshBasicMaterial({ color: ['#ff3d7f', '#ffd23f', '#22c55e', '#4cc9f0', '#ff8c00'][i % 5] }), V(Math.sin(a) * r, y, Math.cos(a) * r * (0.74 + F * 0.06))); b.castShadow = false; b.userData.twinkle = i; } }

  // ---------- the whole rider stands on the snow ----------
  root.traverse((m) => { if (m.isMesh && m.material?.side === DoubleSide) m.castShadow = true; });
  return { root, rig, gear, lower, upper, head, arms, dispose: () => disposables.forEach((d) => d.dispose?.()) };
}

export function createRiderViewer(host, { palette, onTrickEnd } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new Scene(); scene.fog = new Fog('#d6ecff', 6, 16);
  const cam = new PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 1.45, 5.6); cam.lookAt(0, 0.98, 0);
  scene.add(new HemisphereLight('#dff1ff', '#f4f8ff', 1.25));
  const sun = new DirectionalLight('#fff5e6', 2.1); sun.position.set(2.5, 5, 3.5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 2.4, bottom: -0.5, near: 1, far: 14 }); sun.shadow.radius = 4; sun.shadow.bias = -0.0005;
  scene.add(sun);
  const groundM = new MeshStandardMaterial({ color: '#f7fbff', roughness: 0.95 });
  const ground = new Mesh(new PlaneGeometry(30, 30), groundM); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // falling snow
  const N = 160, sp = new Float32Array(N * 3); for (let i = 0; i < N; i++) { sp[i * 3] = (Math.random() - 0.5) * 6; sp[i * 3 + 1] = Math.random() * 3.2; sp[i * 3 + 2] = (Math.random() - 0.5) * 4; }
  const snowG = new BufferGeometry(); snowG.setAttribute('position', new Float32BufferAttribute(sp, 3));
  const snowM = new PointsMaterial({ color: '#ffffff', size: 0.035, transparent: true, opacity: 0.9, depthWrite: false });
  const snow = new Points(snowG, snowM); scene.add(snow);

  let R = null, yaw = -0.35, vel = 0, drag = false, lastX = 0, trickT = -1, ride = 0, raf = 0, t0 = performance.now(), dead = false;
  const size = () => { const w = host.clientWidth || 320, h = host.clientHeight || 260; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(host); size();

  const el = renderer.domElement; el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', (e) => { drag = true; lastX = e.clientX; vel = 0; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - lastX; lastX = e.clientX; yaw += dx * 0.012; vel = dx * 0.012; });
  const up = () => { drag = false; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);

  function update(o, P) {
    if (R) { scene.remove(R.root); R.dispose(); }
    R = buildRider(o, P); ride = o.ride; scene.add(R.root);
  }
  function frame(now) {
    if (dead) return;
    if (!host.isConnected) { destroy(); return; }
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    if (!drag) { yaw += vel; vel *= 0.95; }
    if (R) {
      const { root, rig, gear, lower, upper, head, arms } = R;
      root.rotation.y = yaw;
      let y = 0, rz = 0, rx = 0, ry = 0, crouch = 0;
      if (ride === 0) { // skier: linked carves, knees absorb, upper body quiet, alternating pole plants
        const c = Math.sin(t * 2.2); rz = c * 0.2; rig.position.x = Math.sin(t * 2.2 - 0.6) * 0.18; crouch = Math.abs(c) * 0.05;
        upper.rotation.y = -c * 0.12; head.rotation.z = c * 0.08;
        arms[0].rotation.x = Math.max(0, Math.sin(t * 2.2)) * -0.35; arms[1].rotation.x = Math.max(0, -Math.sin(t * 2.2)) * -0.35;
      } else { // snowboarder: heel/toe rock, a little ollie every few seconds
        rx = Math.sin(t * 1.7) * 0.1; ry = Math.sin(t * 0.85) * 0.22;
        const p = (t % 4.2) / 0.7; if (p < 1) { y = Math.sin(p * Math.PI) * 0.3; gear.rotation.z = Math.sin(p * Math.PI) * 0.25; crouch = (1 - Math.sin(p * Math.PI)) * 0.04; } else gear.rotation.z = 0;
        arms[0].rotation.z = Math.sin(t * 1.7) * 0.08; arms[1].rotation.z = Math.sin(t * 1.7) * 0.08;
      }
      if (trickT >= 0) { // helicopter (ski) / 360 with a grab (board)
        const p = Math.min(1, (t - trickT) / 1.5), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        y += Math.sin(p * Math.PI) * 0.75; ry += e * Math.PI * 2; crouch += Math.sin(p * Math.PI) * 0.12; if (ride === 1) rz += Math.sin(p * Math.PI) * 0.35;
        if (p >= 1) { trickT = -1; onTrickEnd?.(); }
      }
      rig.position.y = y; rig.rotation.set(rx, ry, rz);
      lower.scale.y = 1 - crouch; upper.position.y = 0.92 * (1 - crouch);
      root.traverse((m) => {
        if (m.userData.cape) m.rotation.x = -0.15 - Math.abs(Math.sin(t * 2.2)) * 0.12 - (y > 0.05 ? 0.25 : 0);
        if (m.userData.wing) m.rotation.z = Math.sin(t * 9) * 0.15 * m.userData.wing;
        if (m.userData.spark) m.scale.setScalar(0.7 + Math.random() * 0.7);
        if (m.userData.bob) m.position.y += Math.sin(t * 3) * 0.0006;
        if (m.userData.twinkle != null) m.visible = Math.sin(t * 4 + m.userData.twinkle) > -0.6;
      });
    }
    const pos = snowG.attributes.position;
    for (let i = 0; i < N; i++) { let yy = pos.getY(i) - 0.012; if (yy < 0) yy = 3.2; pos.setY(i, yy); pos.setX(i, pos.getX(i) + Math.sin(t + i) * 0.0015); }
    pos.needsUpdate = true;
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(frame);
  function destroy() {
    if (dead) return; dead = true; cancelAnimationFrame(raf); ro.disconnect();
    if (R) R.dispose(); snowG.dispose(); snowM.dispose(); ground.geometry.dispose(); groundM.dispose();
    renderer.dispose(); renderer.forceContextLoss?.(); el.remove();
  }
  return { update, trick: () => { trickT = (performance.now() - t0) / 1000; }, destroy };
}
