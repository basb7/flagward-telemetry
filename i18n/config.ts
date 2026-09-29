/**
 * Locale configuration shared across server code, proxy.ts and Client
 * Components. Kept free of any `next/*` import so it can be imported from
 * `proxy.ts` (which runs on the edge runtime) as well as from Client
 * Components (which cannot import server-only modules).
 */

export const locales = ['en', 'es'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
