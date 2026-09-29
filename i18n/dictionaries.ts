import { notFound } from 'next/navigation';
import { lang } from 'next/root-params';
import { isLocale, type Locale } from './config';
import type en from './dictionaries/en.json';

export type Dictionary = typeof en;

/**
 * Annotating the record is what enforces dictionary parity: every loader must
 * return the shape derived from en.json, so a key that is missing or renamed
 * in one dictionary fails the build instead of rendering as `undefined`.
 */
const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import('./dictionaries/en.json').then((m) => m.default),
  es: () => import('./dictionaries/es.json').then((m) => m.default),
};

export async function getLocale(): Promise<Locale> {
  const value = await lang();
  if (!value || !isLocale(value)) notFound();
  return value;
}

export async function getDictionary(): Promise<Dictionary> {
  const locale = await getLocale();
  return dictionaries[locale]();
}

/**
 * Route Handlers (e.g. opengraph-image/twitter-image) receive the dynamic
 * segment via their `params` prop instead — `next/root-params` isn't
 * supported there yet, so `getDictionary` can't be used in that context.
 */
export function getDictionaryForLocale(locale: Locale): Promise<Dictionary> {
  return dictionaries[locale]();
}
