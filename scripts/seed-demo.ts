/**
 * Fills a LOCAL database with fake established installations so the public
 * page can be checked with real-looking breakdowns.
 *
 *   DATABASE_URL=postgres://telemetry:telemetry@localhost:5433/telemetry \
 *     node scripts/seed-demo.ts
 *
 * Refuses to run against anything but localhost: demo rows must never reach
 * the production database.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import base from '../tests/fixtures/with-sdks.json' with { type: 'json' };

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('seed-demo only runs against a localhost DATABASE_URL.');
  process.exit(1);
}

const sql = postgres(url);
const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

function pick<T>(items: readonly T[], i: number): T {
  return items[i % items.length];
}

const versions = ['0.6.0', '0.6.0', '0.6.0', '0.5.0', '0.5.0', '0.4.1'];
const sdkSets = [
  [['react', '0.4.0']],
  [
    ['react', '0.4.0'],
    ['vue', '0.3.0'],
  ],
  [['vue', '0.3.0']],
  [['react', '0.3.0']],
  [],
  [['svelte', '0.2.0']],
];
const buckets = ['0', '1-100', '100-1k', '1k-10k'];

for (let i = 0; i < 40; i++) {
  const id = randomUUID();
  const payload = structuredClone(base) as typeof base & { sdks: unknown[] };
  payload.installation_id = id;
  payload.mode = i % 3 === 0 ? 'development' : 'production';
  payload.flagward_version = pick(versions, i);
  payload.runtime.deployment = i % 4 === 0 ? 'bare' : 'docker';
  payload.runtime.database = i % 4 === 0 ? 'sqlite' : 'postgresql';
  payload.runtime.redis_enabled = i % 4 !== 0;
  payload.usage.flags.total = 3 + ((i * 7) % 40);
  payload.usage.flags.multivariate = i % 3 === 0 ? 2 : 0;
  payload.usage.rules_with_rollout = i % 4 === 0 ? 1 : 0;
  payload.usage.active_overrides = i % 9 === 0 ? 1 : 0;
  payload.evaluations_24h_bucket = pick(
    buckets,
    i,
  ) as typeof base.evaluations_24h_bucket;
  payload.sdks = pick(sdkSets, i).map(([type, version]) => ({
    type,
    version,
    active_7d: 1 + (i % 3),
  }));

  // Spread first reception over the last ~10 weeks; one-day installs every 8th.
  const firstDaysAgo = 1 + ((i * 11) % 70);
  const days =
    i % 8 === 7 ? [firstDaysAgo] : [firstDaysAgo, firstDaysAgo / 2, 0];
  const received = [...new Set(days.map((d) => Math.floor(d)))]
    .sort((a, b) => b - a)
    .map((d) => new Date(now - d * DAY_MS));

  await sql`
    INSERT INTO installations (id, first_seen_at, first_received_at, last_received_at, days_seen, latest)
    VALUES (${id}, ${received[0]}, ${received[0]}, ${received[received.length - 1]}, ${received.length}, ${sql.json(payload)})
  `;
  for (const at of received) {
    await sql`
      INSERT INTO heartbeats (installation_id, day, received_at, payload)
      VALUES (${id}, ${at.toISOString().slice(0, 10)}, ${at}, ${sql.json(payload)})
      ON CONFLICT DO NOTHING
    `;
  }
}

console.log('Seeded 40 demo installations.');
await sql.end();
