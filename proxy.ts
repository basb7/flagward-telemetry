import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { defaultLocale, isLocale, type Locale, locales } from './i18n/config';

const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * Parses an `Accept-Language` header by hand: splits on commas, reads each
 * tag's optional `;q=` weight (defaulting to 1), and sorts by weight
 * descending. No dependency needed for two locales.
 */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(';');
      const tag = rawTag.trim();
      const qParam = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='));
      const quality = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 1 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}

/**
 * Matches a list of preferred language tags (most preferred first) against
 * the supported locales, first by exact tag and then by primary subtag
 * (e.g. `en-US` falls back to `en`).
 */
function matchLocale(preferredTags: string[]): Locale | null {
  for (const tag of preferredTags) {
    const normalized = tag.toLowerCase();
    if (isLocale(normalized)) return normalized;
  }

  for (const tag of preferredTags) {
    const primarySubtag = tag.toLowerCase().split('-')[0];
    if (isLocale(primarySubtag)) return primarySubtag;
  }

  return null;
}

function getLocale(request: NextRequest): Locale {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;

  const acceptLanguage = request.headers.get('accept-language');
  if (acceptLanguage) {
    const matched = matchLocale(parseAcceptLanguage(acceptLanguage));
    if (matched) return matched;
  }

  return defaultLocale;
}

/**
 * Paths the locale redirect must never touch. Flagward posts heartbeats with
 * urllib, which does not follow redirects for POST: redirecting /v1/heartbeat
 * would silently drop every heartbeat. Checked here as well as in the matcher,
 * so a matcher edit alone cannot break ingestion.
 */
const API_PATH = /^\/(?:v1|health)(?:\/|$)/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (API_PATH.test(pathname)) return;

  const pathnameHasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (pathnameHasLocale) return;

  const locale = getLocale(request);
  request.nextUrl.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ['/((?!_next|v1(?:/|$)|health(?:/|$)|.*\\..*).*)'],
};
