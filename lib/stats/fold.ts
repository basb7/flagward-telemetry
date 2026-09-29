/**
 * Minimum group size. A breakdown category with fewer installations than this
 * is never published by name: it is merged into "other".
 */
export const K = 5;

/** Published instead of an exact count when "other" itself is under K. */
export const SMALL = '< 5';

export const OTHER = 'other';

export type Category = { value: string; installs: number };
export type PublishedCategory = {
  value: string;
  installs: number | typeof SMALL;
};

export function fold(categories: Category[]): PublishedCategory[] {
  const kept: Category[] = [];
  let other = 0;
  for (const category of categories) {
    if (category.value === OTHER || category.installs < K) {
      other += category.installs;
    } else {
      // A fresh object: nothing but value and installs is ever published.
      kept.push({ value: category.value, installs: category.installs });
    }
  }
  kept.sort(
    (a, b) => b.installs - a.installs || a.value.localeCompare(b.value),
  );

  const published: PublishedCategory[] = kept;
  if (other > 0) {
    published.push({ value: OTHER, installs: other < K ? SMALL : other });
  }
  return published;
}
