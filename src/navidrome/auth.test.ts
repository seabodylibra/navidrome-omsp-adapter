import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSubsonicCredentials } from './auth.js';

test('Subsonic auth hashes password plus a cryptographically random per-request salt', () => {
  const first = createSubsonicCredentials('user with space', 'p@ss/word?&', 'a1b2c3d4');
  const second = createSubsonicCredentials('user with space', 'p@ss/word?&', 'different-salt');
  assert.equal(first.t, createHash('md5').update('p@ss/word?&a1b2c3d4').digest('hex'));
  assert.equal(first.s, 'a1b2c3d4');
  assert.notEqual(first.t, second.t);
  assert.equal('p' in first, false);
  const generatedA = createSubsonicCredentials('u', 'p');
  const generatedB = createSubsonicCredentials('u', 'p');
  assert.notEqual(generatedA.s, generatedB.s);
  assert.ok(generatedA.s.length >= 16);
});
