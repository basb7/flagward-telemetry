/**
 * The locale proxy redirects unprefixed page paths to /{locale}. It must never
 * touch the API: Flagward posts heartbeats with urllib, which does not follow
 * redirects for POST, so a redirect on /v1/heartbeat would silently drop every
 * heartbeat from every installation.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '@/proxy';

const matcher = new RegExp(`^${config.matcher[0]}$`);

function request(path: string, init: { method?: string; lang?: string } = {}) {
  return new NextRequest(`https://telemetry.flagward.com${path}`, {
    method: init.method ?? 'GET',
    headers: init.lang ? { 'accept-language': init.lang } : {},
  });
}

describe('matcher', () => {
  it.each([
    '/v1/heartbeat',
    '/v1/stats',
    '/health',
    '/_next/static/chunk.js',
    '/logo.png',
  ])('does not run on %s', (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it.each(['/', '/en', '/es', '/about'])('runs on %s', (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  it('does not exclude page paths that merely start like an API path', () => {
    expect(matcher.test('/v1-roadmap')).toBe(true);
    expect(matcher.test('/healthy')).toBe(true);
  });
});

describe('proxy', () => {
  it.each(['/v1/heartbeat', '/v1/stats', '/health'])(
    'never redirects %s, even if the matcher changes',
    (path) => {
      expect(proxy(request(path, { method: 'POST' }))).toBeUndefined();
    },
  );

  it('redirects the root to the preferred locale', () => {
    const response = proxy(request('/', { lang: 'es-AR,es;q=0.9' }));

    expect(response?.headers.get('location')).toBe(
      'https://telemetry.flagward.com/es',
    );
  });

  it('falls back to English', () => {
    const response = proxy(request('/', { lang: 'fr' }));

    expect(response?.headers.get('location')).toBe(
      'https://telemetry.flagward.com/en',
    );
  });

  it('leaves locale-prefixed paths alone', () => {
    expect(proxy(request('/es'))).toBeUndefined();
  });
});
