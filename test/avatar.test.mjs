import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAv, decodeAv, randomAvatar, avatarSvg, avatar3d, normAv } from '../lib/avatar.js';
test('avatar encode/decode round-trips and renders', () => {
  for (let i = 0; i < 200; i++) {
    const a = normAv(randomAvatar());
    assert.deepEqual(decodeAv(encodeAv(a)), a);
    avatarSvg(a); avatarSvg(a, { mode: 'badge' }); avatar3d(a);
  }
  assert.equal(decodeAv('<script>'), null);
  assert.equal(decodeAv('1.0.7.2.5.1.6.1.2.2').acc[0], 'gopro'); // v1 still reads
  assert.ok(!encodeAv({ title: 'a|b<c>' }).includes('<'));
});
