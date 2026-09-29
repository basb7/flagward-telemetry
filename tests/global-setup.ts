import { createDatabase } from '@/lib/db/client';
import { applyMigrations } from '@/lib/db/migrate';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://telemetry:telemetry@localhost:5433/telemetry_test';

export default async function setup() {
  const db = createDatabase(TEST_DATABASE_URL);
  await applyMigrations(db);
  await db.$client.end();
}
