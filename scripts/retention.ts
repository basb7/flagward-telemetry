/**
 * Runs retention once a day, forever (the `retention` compose service).
 * A failed run is logged and retried the next day; the loop never exits on it.
 *
 *   DATABASE_URL=... node scripts/retention.ts [--once]
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { RETENTION, runRetention } from '../lib/retention.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const client = postgres(url, { max: 1 });
const db = drizzle(client);

async function runOnce() {
  try {
    const deleted = await runRetention(db);
    console.log(
      `Retention (${RETENTION}): deleted ${deleted.installations} installations, ${deleted.heartbeats} heartbeats.`,
    );
  } catch (error) {
    console.error('Retention failed:', error);
  }
}

await runOnce();
if (process.argv.includes('--once')) {
  await client.end();
} else {
  setInterval(runOnce, DAY_MS);
}
