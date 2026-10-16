export interface Config {
  navidromeUrl: URL;
  username: string;
  password: string;
  omspToken: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  streamMode: 'redirect' | 'proxy';
  publicUrl?: URL;
}

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${key}`);
  return value;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const navidromeUrl = new URL(required(env, 'NAVIDROME_URL'));
  if (!['http:', 'https:'].includes(navidromeUrl.protocol)) throw new Error('NAVIDROME_URL must use HTTP or HTTPS');
  if (navidromeUrl.username || navidromeUrl.password) throw new Error('Put Navidrome credentials in NAVIDROME_USERNAME and NAVIDROME_PASSWORD, not NAVIDROME_URL');
  navidromeUrl.search = '';
  navidromeUrl.hash = '';
  if (!navidromeUrl.pathname.endsWith('/')) navidromeUrl.pathname += '/';
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) throw new Error('Invalid LOG_LEVEL');
  const streamMode = env.STREAM_MODE ?? 'redirect';
  if (streamMode !== 'redirect' && streamMode !== 'proxy') throw new Error('STREAM_MODE must be redirect or proxy');
  const publicUrlText = env.PUBLIC_URL?.trim();
  const publicUrl = publicUrlText ? new URL(publicUrlText) : undefined;
  if (publicUrl && !['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('PUBLIC_URL must use HTTP or HTTPS');
  if (publicUrl) { publicUrl.search = ''; publicUrl.hash = ''; if (!publicUrl.pathname.endsWith('/')) publicUrl.pathname += '/'; }
  return {
    navidromeUrl, username: required(env, 'NAVIDROME_USERNAME'), password: required(env, 'NAVIDROME_PASSWORD'),
    omspToken: required(env, 'OMSP_TOKEN'), port,
    logLevel: logLevel as Config['logLevel'], streamMode,
    ...(publicUrl ? { publicUrl } : {}),
  };
}
