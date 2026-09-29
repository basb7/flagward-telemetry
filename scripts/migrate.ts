/**
 * Applies pending migrations from ./drizzle, then exits. Run once before the
 * app starts (the `migrate` compose service). Idempotent.
 *
 *   DATABASE_URL=... node scripts/migrate.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// onnotice: silences "already exists, skipping" notices on every re-run.
const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
console.log('Migrations applied.');
await client.end();
