import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client';

/** Applies every pending migration in ./drizzle. Idempotent. */
export async function applyMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: 'drizzle' });
}
