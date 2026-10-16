import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { NavidromeClient } from '../src/navidrome/client.js';
import { Child, Playlist } from '../src/navidrome/types.js';

const config = loadConfig();
const client = new NavidromeClient(config, fetch, entry => console.info(`Navidrome ${entry.endpoint}: HTTP ${entry.status} (${entry.latencyMs} ms)`));

async function main(): Promise<void> {
  await client.call('ping');
  const account = await client.call<{ user?: { username?: string } }>('getUser', { username: config.username });
  assert.ok(account.user?.username, 'getUser returned no username');
  const query = process.env.NAVIDROME_TEST_QUERY ?? 'music';
  const results = await client.call<{ searchResult3?: { song?: Child[] } }>('search3', { query, songCount: 10, albumCount: 0, artistCount: 0 });
  const song = results.searchResult3?.song?.[0];
  assert.ok(song, `No songs returned for test query: ${query}`);
  const playlists = await client.call<{ playlists?: { playlist?: Playlist[] } }>('getPlaylists', { username: config.username });
  const playlist = playlists.playlists?.playlist?.[0];
  if (playlist) {
    const detail = await client.call<{ playlist?: Playlist }>('getPlaylist', { id: playlist.id });
    assert.ok(detail.playlist, 'getPlaylist returned no playlist');
  } else console.warn('No playlist exists; list endpoint was verified, detail was skipped.');
  const songData = await client.call<{ song?: Child }>('getSong', { id: song.id });
  assert.ok(songData.song, 'getSong returned no song');
  const stream = client.mediaUrl('stream', song.id, { maxBitRate: 0 });
  const streamResult = await client.mediaRequest('stream', stream, { Range: 'bytes=0-0' });
  assert.ok([200, 206].includes(streamResult.status), `Unexpected stream response: ${streamResult.status}`);
  await streamResult.body?.cancel();
  if (song.coverArt) {
    const cover = await client.mediaRequest('getCoverArt', client.mediaUrl('getCoverArt', song.coverArt, { size: 96 }));
    assert.ok(cover.ok, `Cover request failed: HTTP ${cover.status}`);
    await cover.body?.cancel();
  } else console.warn('Test song has no coverArt; cover request was skipped.');
  try {
    const lyrics = await client.call<{ lyricsList?: unknown }>('getLyricsBySongId', { id: song.id });
    console.info(`Lyrics endpoint responded${lyrics.lyricsList ? ' with lyric data' : ' without lyrics for this song'}.`);
  } catch {
    const legacy = await client.call('getLyrics', { artist: song.artist, title: song.title });
    console.info(`OpenSubsonic lyrics extension unavailable; legacy getLyrics responded (${Boolean(legacy)}).`);
  }
  console.info('Navidrome smoke test passed: ping, login, search, playlist, song, stream, cover, lyrics.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Navidrome smoke test failed');
  process.exitCode = 1;
});
