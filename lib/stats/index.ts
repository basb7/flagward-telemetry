import { cacheLife } from 'next/cache';
import { getDatabase } from '@/lib/db/client';
import { computeStats, type StatsV1 } from './query';

export type { StatsV1 } from './query';

/**
 * The one entry point for published stats, shared by the page and /v1/stats so
 * both always show the same numbers. Recomputed at most every 15 minutes:
 * after that the next request gets the cached result and triggers a
 * background refresh.
 *
 * Callers MUST `await connection()` first, or Cache Components would try to
 * fill this at build time, where there is no database.
 */
export async function getStats(): Promise<StatsV1> {
  'use cache';
  cacheLife({ revalidate: 900, expire: 3600 });
  return computeStats(getDatabase());
}
