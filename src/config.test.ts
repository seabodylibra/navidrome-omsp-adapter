import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const baseEnv: NodeJS.ProcessEnv = {
  NAVIDROME_URL: 'http://localhost:4533', NAVIDROME_USERNAME: 'reader',
  NAVIDROME_PASSWORD: 'password', OMSP_TOKEN: 'test-token',
};

test('album browsing defaults off and has a bounded default limit', () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.exposeAlbumsInLibrary, false);
  assert.equal(config.albumBrowseLimit, 2000);
  assert.equal(loadConfig({ ...baseEnv, EXPOSE_ALBUMS_IN_LIBRARY: 'true', ALBUM_BROWSE_LIMIT: '10000' }).exposeAlbumsInLibrary, true);
  assert.equal(loadConfig({ ...baseEnv, ALBUM_BROWSE_LIMIT: '1' }).albumBrowseLimit, 1);
});

test('album browsing config rejects invalid boolean and limits', () => {
  assert.throws(() => loadConfig({ ...baseEnv, EXPOSE_ALBUMS_IN_LIBRARY: 'yes' }), /EXPOSE_ALBUMS_IN_LIBRARY/);
  for (const value of ['0', '-1', '10001', '1.5', 'NaN']) {
    assert.throws(() => loadConfig({ ...baseEnv, ALBUM_BROWSE_LIMIT: value }), /ALBUM_BROWSE_LIMIT/);
  }
});
