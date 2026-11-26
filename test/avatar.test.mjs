import { encodeAv, decodeAv, randomAvatar, avatarSvg } from '../lib/avatar.js';
for (let i=0;i<200;i++){ const a=randomAvatar(); const d=decodeAv(encodeAv(a)); if (JSON.stringify(d)!==JSON.stringify(a)) throw new Error('roundtrip'); avatarSvg(a); avatarSvg(a,{mode:'badge'}); }
if (decodeAv('<script>')!==null) throw new Error('bad accepted');
console.log('ok', encodeAv(randomAvatar()));
