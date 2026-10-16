import { Config } from '../config.js';
import { createSubsonicCredentials } from './auth.js';
import { SubsonicEnvelope } from './types.js';

export class NavidromeError extends Error {
  constructor(message: string, readonly statusCode = 502) { super(message); }
}

export class NavidromeClient {
  constructor(private readonly config: Config, private readonly fetcher: typeof fetch = fetch,
    private readonly log: (entry: { endpoint: string; status: number; latencyMs: number }) => void = () => {}) {}

  async call<T>(endpoint: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    if (!/^[a-zA-Z0-9]+$/.test(endpoint)) throw new Error('Invalid Navidrome endpoint');
    const url = new URL(`rest/${endpoint}.view`, this.config.navidromeUrl);
    for (const [key, value] of Object.entries({ ...createSubsonicCredentials(this.config.username, this.config.password), ...params })) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    } catch {
      this.log({ endpoint, status: 0, latencyMs: Math.round(performance.now() - started) });
      throw new NavidromeError('Navidrome is unreachable');
    }
    this.log({ endpoint, status: response.status, latencyMs: Math.round(performance.now() - started) });
    if (!response.ok) { await response.body?.cancel(); throw new NavidromeError('Navidrome request failed', response.status === 401 ? 502 : 502); }
    let payload: SubsonicEnvelope<T>;
    try { payload = await response.json() as SubsonicEnvelope<T>; }
    catch { throw new NavidromeError('Navidrome returned invalid JSON'); }
    const result = payload['subsonic-response'];
    if (!result || result.status !== 'ok') {
      const upstreamCode = result?.error?.code;
      throw new NavidromeError(upstreamCode === 40 || upstreamCode === 41 || upstreamCode === 42 ? 'Navidrome rejected configured credentials' : 'Navidrome API request failed');
    }
    return result as T;
  }

  async mediaRequest(endpoint: 'stream' | 'getCoverArt', url: URL, headers: HeadersInit = {}): Promise<Response> {
    const started = performance.now();
    try {
      const response = await this.fetcher(url, { headers, signal: AbortSignal.timeout(120_000) });
      this.log({ endpoint, status: response.status, latencyMs: Math.round(performance.now() - started) });
      return response;
    } catch {
      this.log({ endpoint, status: 0, latencyMs: Math.round(performance.now() - started) });
      throw new NavidromeError('Navidrome media request failed');
    }
  }

  mediaUrl(endpoint: 'stream' | 'getCoverArt', id: string, params: Record<string, string | number | undefined> = {}): URL {
    const url = new URL(`rest/${endpoint}.view`, this.config.navidromeUrl);
    for (const [key, value] of Object.entries({ ...createSubsonicCredentials(this.config.username, this.config.password), id, ...params })) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }
}
