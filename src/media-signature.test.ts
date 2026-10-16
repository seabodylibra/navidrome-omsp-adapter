import test from 'node:test';
import assert from 'node:assert/strict';
import { signMedia, verifyMedia } from './media-signature.js';

test('media signatures are scoped to type and id; cover links remain stable', () => {
  const cover = signMedia('test-secret', 'cover', 'cover-id');
  assert.equal(cover.expires, '0');
  assert.equal(verifyMedia('test-secret', 'cover', 'cover-id', cover.expires, cover.sig), true);
  assert.equal(verifyMedia('test-secret', 'stream', 'cover-id', cover.expires, cover.sig), false);
  assert.equal(verifyMedia('test-secret', 'cover', 'other-id', cover.expires, cover.sig), false);
});

test('stream capability expires and rejects tampering', () => {
  const stream = signMedia('secret', 'stream', '123', 60);
  assert.equal(verifyMedia('secret', 'stream', '123', stream.expires, stream.sig), true);
  assert.equal(verifyMedia('secret', 'stream', '123', stream.expires, `${stream.sig}x`), false);
  assert.equal(verifyMedia('secret', 'stream', '123', '1', stream.sig), false);
});
