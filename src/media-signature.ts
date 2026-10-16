import { createHmac, timingSafeEqual } from 'node:crypto';

const signature = (secret: string, kind: 'stream' | 'cover', id: string, expires: string) =>
  createHmac('sha256', secret).update(`${kind}\n${id}\n${expires}`).digest('base64url');

export function signMedia(secret: string, kind: 'stream' | 'cover', id: string, ttlSeconds = 7 * 86400): { expires: string; sig: string } {
  const expires = kind === 'cover' ? '0' : String(Math.floor(Date.now() / 1000) + ttlSeconds);
  return { expires, sig: signature(secret, kind, id, expires) };
}

export function verifyMedia(secret: string, kind: 'stream' | 'cover', id: string, expires: string, sig: string): boolean {
  if (kind === 'stream' && (!/^\d+$/.test(expires) || Number(expires) < Math.floor(Date.now() / 1000))) return false;
  if (kind === 'cover' && expires !== '0') return false;
  const expected = Buffer.from(signature(secret, kind, id, expires)); const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
