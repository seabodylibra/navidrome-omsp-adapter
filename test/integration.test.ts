import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.js';
import { Config } from '../src/config.js';
import { signMedia } from '../src/media-signature.js';

const config: Config = {
  navidromeUrl: new URL('https://nas.example/music/'), username: 'user + name', password: 'secret/pass?&',
  omspToken: 'a-long-test-token', port: 3000, logLevel: 'silent', streamMode: 'redirect',
};
function mockNavidrome(calls: URL[]) {
  return async (input: URL | RequestInfo): Promise<Response> => {
    const url = input instanceof URL ? input : new URL(String(input)); calls.push(url);
    const endpoint = url.pathname.split('/').pop();
    let data: Record<string, unknown> = {};
    if (endpoint === 'getCoverArt.view') return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg', 'content-length': '3', etag: '"cover-v1"' } });
    if (endpoint === 'ping.view') data = {};
    if (endpoint === 'getUser.view') data = { user: { username: 'test-user' } };
    if (endpoint === 'search3.view') data = { searchResult3: { song: [{ id: '9', title: 'Test Song', artist: 'A', artistId: '1', album: 'B', albumId: '2', coverArt: 'cover-9', duration: 180, bitRate: 256, size: 9000, suffix: 'mp3' }] } };
    if (endpoint === 'getSong.view') data = { song: { id: '9', title: 'Test Song', artist: 'A', artistId: '1', album: 'B', albumId: '2', coverArt: 'cover-9', duration: 180, bitRate: 256, size: 9000, suffix: 'mp3' } };
    if (endpoint === 'getStarred2.view') data = { starred2: { song: [{ id: '9' }] } };
    if (endpoint === 'getPlaylists.view') data = { playlists: { playlist: [{ id: 'p1', name: 'My mix', owner: 'test-user', songCount: 1 }] } };
    if (endpoint === 'getPlaylist.view') data = { playlist: { id: 'p1', name: 'My mix', owner: 'test-user', songCount: 1, entry: [{ id: '9', title: 'Test Song', artist: 'A', album: 'B', albumId: '2', duration: 180, suffix: 'mp3' }] } };
    if (endpoint === 'getAlbum.view') data = { album: { id: '2', name: 'B', artist: 'A', artistId: '1', songCount: 1, song: [{ id: '9', title: 'Test Song', artist: 'A', artistId: '1', album: 'B', albumId: '2', duration: 180, suffix: 'mp3' }] } };
    if (endpoint === 'getArtist.view') data = { artist: { id: '1', name: 'A', album: [{ id: '2', name: 'B', song: [{ id: '9', title: 'Test Song', artist: 'A', artistId: '1', album: 'B', albumId: '2', duration: 180, suffix: 'mp3' }] }] } };
    if (endpoint === 'getLyricsBySongId.view') return new Response('not supported', { status: 404 });
    if (endpoint === 'getLyrics.view') data = { lyrics: { value: '[00:01.00]hi' } };
    return Response.json({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...data } });
  };
}

test('Cloud Share contract: token status, search, song meta, and redirect keep Navidrome password private', async () => {
  const calls: URL[] = []; const app = createApp(config, mockNavidrome(calls));
  try {
    const denied = await app.inject({ method: 'GET', url: '/connect/status' });
    assert.equal(denied.statusCode, 401);
    const status = await app.inject({ method: 'GET', url: '/connect/status', headers: { token: config.omspToken } });
    assert.equal(status.json().code, 0); assert.equal(status.json().data.id, config.username);
    const results = await app.inject({ method: 'GET', url: '/search?keywords=hello%20world&limit=5', headers: { token: config.omspToken } });
    assert.equal(results.json().data.songs[0].name, 'Test Song');
    assert.deepEqual(results.json().data.albums, []);
    assert.deepEqual(results.json().data.playlists, []);
    const detail = await app.inject({ method: 'GET', url: '/song/detail?id=9&br=320000', headers: { token: config.omspToken, host: 'adapter.test:3000' } });
    assert.equal(detail.json().data.duration, 180000);
    assert.equal(detail.json().data.meta.isFavorite, true);
    assert.equal(detail.json().data.meta.lyric.normal, '[00:01.00]hi');
    const coverUrl = new URL(detail.json().data.album.cover);
    assert.equal(coverUrl.search, '');
    const coverResponse = await app.inject({ method: 'GET', url: `${coverUrl.pathname}?param=512y512` });
    assert.equal(coverResponse.statusCode, 200);
    assert.equal(coverResponse.headers['content-type'], 'image/jpeg');
    assert.equal(coverResponse.rawPayload.length, 3);
    const coverCall = calls.find(url => url.pathname.endsWith('getCoverArt.view'))!;
    assert.equal(coverCall.searchParams.get('size'), '512');
    const media = new URL(detail.json().data.meta.url);
    assert.equal(media.pathname, '/media/stream/9/Test_Song.mp3');
    const redirected = await app.inject({ method: 'GET', url: `${media.pathname}${media.search}` });
    assert.equal(redirected.statusCode, 307);
    const location = new URL(redirected.headers.location!);
    assert.equal(location.pathname, '/music/rest/stream.view');
    assert.equal(location.searchParams.get('u'), config.username);
    assert.equal(location.searchParams.get('p'), null);
    assert.equal(location.searchParams.get('id'), '9');
    assert.equal(location.searchParams.get('t'), createHash('md5').update(`secret/pass?&${location.searchParams.get('s')}`).digest('hex'));
    assert.equal(media.searchParams.has('t'), false);
    assert.equal(media.searchParams.has('u'), false);
    assert.equal(calls.some(url => url.search.includes('secret/pass')), false);
    assert.equal(calls.find(url => url.pathname.endsWith('search3.view'))?.searchParams.get('query'), 'hello world');
    const songCall = calls.find(url => url.pathname.endsWith('getSong.view'))!;
    assert.equal(songCall.searchParams.get('u'), config.username);
    assert.equal(songCall.searchParams.has('p'), false);
    assert.equal(songCall.searchParams.get('t'), createHash('md5').update(`secret/pass?&${songCall.searchParams.get('s')}`).digest('hex'));
  } finally { await app.close(); }
});

test('proxy mode preserves byte-range playback for FLAC, MP3, and AAC', async () => {
  const proxyConfig = { ...config, streamMode: 'proxy' as const };
  const app = createApp(proxyConfig, async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.pathname.endsWith('/stream.view')) {
      const range = new Headers(init?.headers).get('range');
      return new Response(new Uint8Array([1, 2, 3]), { status: range ? 206 : 200, headers: {
        'content-type': ({ '101': 'audio/flac', '102': 'audio/mpeg', '103': 'audio/aac' } as Record<string, string>)[url.searchParams.get('id')!]!,
        'content-length': '3', 'accept-ranges': 'bytes', ...(range ? { 'content-range': 'bytes 0-2/10' } : {}),
      } });
    }
    return Response.json({ 'subsonic-response': { status: 'ok' } });
  });
  try {
    const cases: Array<[string, string, string]> = [['101', 'flac', 'audio/flac'], ['102', 'mp3', 'audio/mpeg'], ['103', 'aac', 'audio/aac']];
    for (const [id, ext, type] of cases) {
      const { expires, sig } = signMedia(config.omspToken, 'stream', id);
      const result = await app.inject({ method: 'GET', url: `/media/stream/${id}/track.${ext}?e=${expires}&s=${sig}`,
        headers: { range: 'bytes=0-2' } });
      assert.equal(result.statusCode, 206);
      assert.equal(result.headers['content-range'], 'bytes 0-2/10', JSON.stringify(result.headers));
      assert.equal(result.headers['content-length'], '3');
      assert.equal(result.headers['accept-ranges'], 'bytes');
      assert.equal(result.headers['content-type'], type);
      assert.equal(result.rawPayload.length, 3);
    }
  } finally { await app.close(); }
});

test('playlist, album, artist details and favorite changes map to OpenSubsonic', async () => {
  const calls: URL[] = []; const app = createApp(config, mockNavidrome(calls));
  const headers = { token: config.omspToken };
  try {
    const lists = await app.inject({ method: 'GET', url: '/playlist/list?uid=user%20%2B%20name', headers });
    assert.deepEqual(lists.json().data.map((item: { id: string }) => item.id), ['starred', 'p1']);
    const playlist = await app.inject({ method: 'GET', url: '/playlist/detail?id=p1&limit=5000', headers });
    assert.equal(playlist.json().data.songs[0].id, '9');
    const album = await app.inject({ method: 'GET', url: '/playlist/detail?id=album%3A2', headers });
    assert.equal(album.json().data.type, 'album');
    assert.equal(album.json().data.songs[0].album.id, '2');
    const artist = await app.inject({ method: 'GET', url: '/artist/detail?id=1', headers });
    assert.equal(artist.json().data.type, 'artist');
    assert.equal(artist.json().data.songs.length, 1);
    const liked = await app.inject({ method: 'PUT', url: '/song/like?id=9&like=true', headers });
    assert.equal(liked.json().data.like, true);
    const unliked = await app.inject({ method: 'PUT', url: '/song/like?id=9&like=false', headers });
    assert.equal(unliked.json().data.like, false);
    assert.equal(calls.some(url => url.pathname.endsWith('/getPlaylist.view') && url.searchParams.get('id') === 'p1'), true);
    assert.equal(calls.some(url => url.pathname.endsWith('/getAlbum.view') && url.searchParams.get('id') === '2'), true);
    assert.equal(calls.some(url => url.pathname.endsWith('/getArtist.view') && url.searchParams.get('id') === '1'), true);
    assert.equal(calls.some(url => url.pathname.endsWith('/star.view') && url.searchParams.get('id') === '9'), true);
    assert.equal(calls.some(url => url.pathname.endsWith('/unstar.view') && url.searchParams.get('id') === '9'), true);
  } finally { await app.close(); }
});
