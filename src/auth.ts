import { timingSafeEqual } from 'node:crypto';
import { FastifyRequest } from 'fastify';
import { Config } from './config.js';

export function hasValidToken(request: FastifyRequest, config: Config): boolean {
  const supplied = request.headers.token;
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied); const b = Buffer.from(config.omspToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
