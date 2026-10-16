import test from 'node:test';
import assert from 'node:assert/strict';
import { asSong } from './models.js';
import { toLrc } from '../navidrome/service.js';

test('song mapping converts seconds to milliseconds and keeps stable media path', () => {
  const song = asSong({ id: '12', title: 'A / Song', artist: 'Artist', artistId: '4', album: 'Album', albumId: '5', duration: 181, bitRate: 320, size: 8000, suffix: 'flac' }, id => `/cover/${id}`, item => `/media/${item.id}/A_Song.flac`);
  assert.equal(song.duration, 181000);
  assert.equal(song.album.id, '5');
  assert.equal(song.meta?.url, '/media/12/A_Song.flac');
  assert.equal(song.meta?.size, 8000);
  assert.equal(song.privilege.playable, true);
});

test('structured lyrics become timestamped LRC without failing for missing data', () => {
  assert.equal(toLrc({ synced: true, line: [{ start: 0, value: 'First' }, { start: 61520, value: 'Next' }] }), '[00:00.00]First\n[01:01.52]Next');
  assert.equal(toLrc({ synced: false, line: [{ value: 'Plain line' }] }), 'Plain line');
  assert.equal(toLrc({ synced: true, offset: 1000, line: [{ start: 3000, value: 'Offset line' }] }), '[00:02.00]Offset line');
  assert.equal(toLrc({}), '');
});
