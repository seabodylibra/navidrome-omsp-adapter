import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Config } from './config.js';
import { hasValidToken } from './auth.js';
import { NavidromeClient, NavidromeError } from './navidrome/client.js';
import { MusicService } from './navidrome/service.js';
import { verifyMedia } from './media-signature.js';

const ok = <T>(data: T) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const failure = (code: number, message: string) => ({ code, message, data: null, timestamp: Date.now() });
const placeholderSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#e8e8e8"/><circle cx="256" cy="256" r="132" fill="#d2d2d2"/><path d="M295 163v157a54 54 0 1 1-24-45V198l112-26v122a54 54 0 1 1-24-45V142z" fill="#8a8a8a"/></svg>';

export function createApp(config: Config, fetcher?: typeof fetch): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel, redact: { paths: ['req.headers.token', 'req.headers.authorization', 'req.headers.cookie', 'req.url'], censor: '[REDACTED]' } },
    trustProxy: false,
    bodyLimit: 64 * 1024,
  });
  const requestBase = new AsyncLocalStorage<URL>();
  const baseFor = (request: FastifyRequest): URL => {
    if (config.publicUrl) return new URL(config.publicUrl.toString().endsWith('/') ? config.publicUrl.toString() : `${config.publicUrl}/`);
    const host = request.headers.host;
    if (!host || !/^[\w.:[\]-]+(?::\d+)?$/.test(host)) throw new Error('Invalid request host');
    return new URL(`${request.protocol}://${host}/`);
  };
  const nav = new NavidromeClient(config, fetcher, entry => app.log.info({ navidrome: entry.endpoint, statusCode: entry.status, latencyMs: entry.latencyMs }, 'Navidrome request'));
  const music = new MusicService(nav, config, () => requestBase.getStore() ?? config.publicUrl ?? new URL('http://localhost/'));
  const authed = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (hasValidToken(request, config)) return true;
    await reply.code(401).send(failure(40100, 'Valid Token header required'));
    return false;
  };
  app.addHook('onRequest', async request => {
    (request as FastifyRequest & { startedAt?: number }).startedAt = performance.now();
    try { requestBase.enterWith(baseFor(request)); } catch { requestBase.enterWith(new URL('http://invalid/')); }
  });
  app.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as FastifyRequest & { startedAt?: number }).startedAt ?? performance.now();
    app.log.info({ method: request.method, route: request.routeOptions.url, statusCode: reply.statusCode, latencyMs: Math.round(performance.now() - startedAt) }, 'OMSP request');
  });
  app.get('/', async () => ({ name: 'omsp-2026-0305', version: '1.0.0' }));
  app.get('/health', async (_request, reply) => {
    try { await nav.call('ping'); return reply.send({ status: 'ok' }); }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.get('/connect/status', async (request, reply) => {
    if (!await authed(request, reply)) return;
    try { return ok(await music.user()); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.get('/playlist/list', async (request, reply) => {
    if (!await authed(request, reply)) return;
    try { return ok(await music.playlists()); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.get<{ Querystring: { limit?: string } }>('/playlist/recommend', async (request, reply) => {
    if (!await authed(request, reply)) return;
    try { return ok((await music.recommendations(parseLimit(request.query.limit, 10))).playlists); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.get<{ Querystring: { limit?: string } }>('/playlist/toplist', async (request, reply) => {
    if (!await authed(request, reply)) return;
    try { return ok((await music.recommendations(parseLimit(request.query.limit, 10))).toplist); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.get<{ Querystring: { limit?: string } }>('/song/recommend', async (request, reply) => {
    if (!await authed(request, reply)) return;
    try { return ok((await music.recommendations(parseLimit(request.query.limit, 10))).songs); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.get<{ Querystring: { limit?: string } }>('/artist/recommend', async (request, reply) => {
    if (!await authed(request, reply)) return;
    try { return ok((await music.recommendations(parseLimit(request.query.limit, 10))).artists); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.get<{ Querystring: { id?: string; limit?: string } }>('/playlist/detail', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.query.id) return reply.code(400).send(failure(40000, 'id is required'));
    try { return ok(await music.playlistDetail(request.query.id)); }
    catch (error) { return reply.code(404).send(failure(40400, publicError(error))); }
  });
  app.get<{ Querystring: { id?: string } }>('/album/detail', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.query.id) return reply.code(400).send(failure(40000, 'id is required'));
    try { return ok(await music.albumDetail(request.query.id)); }
    catch (error) { return reply.code(error instanceof NavidromeError ? 502 : 404).send(failure(error instanceof NavidromeError ? 50200 : 40400, publicError(error))); }
  });
  app.get<{ Querystring: { id?: string } }>('/artist/detail', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.query.id) return reply.code(400).send(failure(40000, 'id is required'));
    try { return ok(await music.artistDetail(request.query.id)); }
    catch (error) { return reply.code(error instanceof NavidromeError ? 502 : 404).send(failure(error instanceof NavidromeError ? 50200 : 40400, publicError(error))); }
  });
  app.get<{ Querystring: { id?: string; br?: string; uid?: string } }>('/song/detail', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.query.id) return reply.code(400).send(failure(40000, 'id is required'));
    try { return ok(await music.songDetail(request.query.id)); }
    catch (error) { return reply.code(error instanceof NavidromeError ? 502 : 404).send(failure(error instanceof NavidromeError ? 50200 : 40400, publicError(error))); }
  });
  app.get<{ Querystring: { keywords?: string; limit?: string } }>('/search', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.query.keywords?.trim()) return ok({ songs: [], albums: [], artists: [], playlists: [] });
    try { return ok(await music.search(request.query.keywords, parseLimit(request.query.limit, 20))); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.put<{ Querystring: { id?: string; like?: string } }>('/song/like', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.query.id) return reply.code(400).send(failure(40000, 'id is required'));
    const like = request.query.like !== 'false';
    try { await music.setFavorite(request.query.id, like); return ok({ id: request.query.id, like, playlist: 'starred' }); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.get<{ Querystring: { id?: string } }>('/song/lyric', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.query.id) return reply.code(400).send(failure(40000, 'id is required'));
    try { const song = await music.songDetail(request.query.id); return ok({ id: song.id, lyric: song.meta?.lyric ?? {} }); }
    catch (error) { return reply.code(error instanceof NavidromeError ? 502 : 404).send(failure(50200, publicError(error))); }
  });
  app.get<{ Querystring: { limit?: string } }>('/album/newest', async (request, reply) => {
    if (!await authed(request, reply)) return;
    try { return ok(await music.newest(parseLimit(request.query.limit, 20))); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });
  app.post<{ Body: { id?: string; time?: number } }>('/song/scrobble', async (request, reply) => {
    if (!await authed(request, reply)) return;
    if (!request.body?.id) return reply.code(400).send(failure(40000, 'id is required'));
    try { await music.scrobble(request.body.id, Number(request.body.time) || 0); return ok({}); }
    catch (error) { return reply.code(502).send(failure(50200, publicError(error))); }
  });

  app.get<{ Params: { type: string } }>('/media/placeholder/v1/:type.svg', async (request, reply) => {
    if (!['album', 'song', 'artist', 'playlist'].includes(request.params.type)) return reply.code(404).send();
    const etag = '"placeholder-v1"';
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.send(placeholderSvg);
  });

  app.get<{ Params: { id: string; expires: string; sig: string }; Querystring: { param?: string } }>('/media/cover/:id/:expires/:sig', async (request, reply) => {
    const { id, expires, sig } = request.params;
    if (!verifyMedia(config.omspToken, 'cover', id, expires, sig)) return reply.code(403).send();
    const target = nav.mediaUrl('getCoverArt', id, { size: request.query.param?.match(/\d+/)?.[0] });
  return proxyMedia(target, request, reply, nav, 'getCoverArt', false);
  });
  app.get<{ Params: { id: string; filename: string }; Querystring: { e?: string; s?: string } }>('/media/stream/:id/:filename', async (request, reply) => {
    const { id } = request.params; const { e, s } = request.query;
    if (!e || !s || !verifyMedia(config.omspToken, 'stream', id, e, s)) return reply.code(403).send();
    const target = nav.mediaUrl('stream', id);
    if (config.streamMode === 'redirect') return reply.code(307).header('Location', target.toString()).header('Cache-Control', 'no-store').send();
    return proxyMedia(target, request, reply, nav, 'stream', true);
  });
  return app;
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 100) : fallback;
}
function publicError(error: unknown): string {
  if (error instanceof NavidromeError) return error.message;
  if (error instanceof Error && error.message.endsWith('not found')) return error.message;
  return 'Request could not be completed';
}
async function proxyMedia(target: URL, request: FastifyRequest, reply: FastifyReply, nav: NavidromeClient,
  endpoint: 'stream' | 'getCoverArt', allowRange: boolean): Promise<unknown> {
  const headers = new Headers();
  if (allowRange && request.headers.range) headers.set('range', request.headers.range);
  if (request.headers['if-none-match']) headers.set('if-none-match', request.headers['if-none-match']);
  let upstream: Response;
  try { upstream = await nav.mediaRequest(endpoint, target, headers); }
  catch { return reply.code(502).send(); }
  const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control'];
  for (const name of pass) { const value = upstream.headers.get(name); if (value) reply.header(name, value); }
  if (allowRange) reply.header('Accept-Ranges', upstream.headers.get('accept-ranges') ?? 'bytes');
  reply.code(upstream.status);
  if (!upstream.body) return reply.send();
  reply.hijack();
  reply.raw.writeHead(upstream.status, reply.getHeaders() as import('node:http').OutgoingHttpHeaders);
  Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(reply.raw);
  return reply;
}
