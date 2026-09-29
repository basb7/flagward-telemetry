/**
 * Raw heartbeats and abandoned installations are deleted after 13 months.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { heartbeats, installations } from '@/lib/db/schema';
import { runRetention } from '@/lib/retention';
import type { HeartbeatV1 } from '@/lib/schema/v1';
import withSdks from '../fixtures/with-sdks.json';
import { resetDatabase, testDb } from './database';

const NOW = new Date('2026-09-29T12:00:00Z');

function monthsAgo(months: number): Date {
  const date = new Date(NOW);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

async function seed(dates: Date[]) {
  const id = randomUUID();
  const payload = { ...structuredClone(withSdks), installation_id: id };
  await testDb.insert(installations).values({
    id,
    firstSeenAt: dates[0],
    firstReceivedAt: dates[0],
    lastReceivedAt: dates[dates.length - 1],
    daysSeen: dates.length,
    latest: payload as HeartbeatV1,
  });
  await testDb.insert(heartbeats).values(
    dates.map((at) => ({
      installationId: id,
      day: at.toISOString().slice(0, 10),
      receivedAt: at,
      payload: payload as HeartbeatV1,
    })),
  );
  return id;
}

async function days(id: string) {
  const rows = await testDb.select().from(heartbeats);
  return rows
    .filter((row) => row.installationId === id)
    .map((row) => row.day)
    .sort();
}

beforeEach(resetDatabase);
afterAll(() => testDb.$client.end());

describe('retention', () => {
  it('deletes heartbeats older than 13 months and keeps newer ones', async () => {
    const id = await seed([monthsAgo(14), monthsAgo(12), monthsAgo(1)]);

    const result = await runRetention(testDb, NOW);

    expect(await days(id)).toEqual([
      monthsAgo(12).toISOString().slice(0, 10),
      monthsAgo(1).toISOString().slice(0, 10),
    ]);
    expect(result.heartbeats).toBe(1);
  });

  it('deletes installations last received over 13 months ago, with their heartbeats', async () => {
    const abandoned = await seed([monthsAgo(16), monthsAgo(14)]);
    const active = await seed([monthsAgo(2), monthsAgo(1)]);

    const result = await runRetention(testDb, NOW);

    const ids = (await testDb.select().from(installations)).map(
      (row) => row.id,
    );
    expect(ids).toEqual([active]);
    expect(await days(abandoned)).toEqual([]);
    expect(result.installations).toBe(1);
  });

  it('is idempotent', async () => {
    await seed([monthsAgo(14), monthsAgo(1)]);
    await runRetention(testDb, NOW);

    const second = await runRetention(testDb, NOW);

    expect(second).toEqual({ heartbeats: 0, installations: 0 });
  });
});
