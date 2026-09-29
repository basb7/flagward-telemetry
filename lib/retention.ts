/**
 * Deletes raw data after the retention window. Installations that went quiet
 * are removed first (their heartbeats go with them through ON DELETE CASCADE),
 * then old heartbeats of installations that are still reporting.
 *
 * Imports are relative with extensions so scripts/retention.ts can run this
 * file directly with Node's type stripping, without a build step.
 */
import { sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';

/** Only raw SQL is used, so any drizzle database will do, schema or not. */
type Executor = Pick<Database, 'execute'>;

export const RETENTION = '13 months';

export async function runRetention(
  db: Executor,
  now: Date = new Date(),
): Promise<{ heartbeats: number; installations: number }> {
  const at = now.toISOString();
  const installations = await db.execute(sql`
    DELETE FROM installations
    WHERE last_received_at < ${at}::timestamptz - ${RETENTION}::interval
    RETURNING 1
  `);
  const heartbeats = await db.execute(sql`
    DELETE FROM heartbeats
    WHERE day < (${at}::timestamptz - ${RETENTION}::interval)::date
    RETURNING 1
  `);
  return { heartbeats: heartbeats.length, installations: installations.length };
}
