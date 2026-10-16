import { createHash, randomBytes } from 'node:crypto';

export interface SubsonicCredentials { u: string; t: string; s: string; v: string; c: string; f: 'json' }

/** Subsonic token auth: MD5(password + fresh, cryptographically random salt). */
export function createSubsonicCredentials(username: string, password: string, salt = randomBytes(16).toString('hex')): SubsonicCredentials {
  const t = createHash('md5').update(password + salt, 'utf8').digest('hex');
  return { u: username, t, s: salt, v: '1.16.1', c: 'navidrome-omsp-adapter', f: 'json' };
}
