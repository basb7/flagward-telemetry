import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Guards a code-side array that is paired positionally with dictionary copy.
 * The two live in different files, so a count mismatch stays invisible until
 * it renders as `undefined` — which React reports as an "invalid element
 * type" crash pointing nowhere near the cause. Failing here names it.
 */
export function assertPairedLength(
  items: readonly unknown[],
  paired: readonly unknown[],
  label: string,
): void {
  if (items.length !== paired.length) {
    throw new Error(
      `${label}: the dictionary has ${items.length} entries but ${paired.length} paired values are defined.`,
    );
  }
}
