import type { Dictionary } from '@/i18n/dictionaries';
import { SMALL } from '@/lib/stats/fold';

export function formatCount(value: number | typeof SMALL, locale: string) {
  return value === SMALL ? SMALL : new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(value: number | typeof SMALL, locale: string) {
  if (value === SMALL) return SMALL;
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value / 100);
}

/** Human label for a breakdown value; unknown values are shown as sent. */
export function valueLabel(value: string, dict: Dictionary) {
  const labels = dict.values as Record<string, string>;
  return labels[value] ?? value;
}
