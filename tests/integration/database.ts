import { sql } from 'drizzle-orm';
import { createDatabase } from '@/lib/db/client';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://telemetry:telemetry@localhost:5433/telemetry_test';

export const testDb = createDatabase(TEST_DATABASE_URL);

export async function resetDatabase(): Promise<void> {
  await testDb.execute(sql`TRUNCATE heartbeats, installations`);
}
