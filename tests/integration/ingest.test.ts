/**
 * POST /v1/heartbeat against a real PostgreSQL: the upserts and the
 * one-row-per-install-per-day rule are the logic, so nothing is mocked.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '@/lib/db/client';
import { heartbeats, installations } from '@/lib/db/schema';
import { handleHealth, handleHeartbeat } from '@/lib/ingest';
import withSdks from '../fixtures/with-sdks.json';
import { resetDatabase, testDb } from './database';

const ID = withSdks.installation_id;
const DAY_1 = new Date('2026-09-29T10:00:00Z');
const DAY_1_LATER = new Date('2026-09-29T23:30:00Z');
const DAY_2 = new Date('2026-09-30T00:15:00Z');

function post(body: unknown, contentType = 'application/json') {
  return new Request('http://collector.test/v1/heartbeat', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function heartbeat(overrides: Record<string, unknown> = {}) {
  return { ...structuredClone(withSdks), ...overrides };
}

async function send(body: unknown, now = DAY_1, contentType?: string) {
  return handleHeartbeat(post(body, contentType), testDb, now);
}

async function rows() {
  return {
    installations: await testDb.select().from(installations),
    heartbeats: await testDb.select().from(heartbeats),
  };
}

beforeEach(resetDatabase);
afterAll(() => testDb.$client.end());

describe('valid heartbeat', () => {
  it('responds 204 with an empty body', async () => {
    const response = await send(heartbeat());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('stores one installation and one heartbeat', async () => {
    await send(heartbeat());

    const stored = await rows();
    expect(stored.installations).toHaveLength(1);
    expect(stored.heartbeats).toHaveLength(1);
    expect(stored.installations[0]).toMatchObject({
      id: ID,
      daysSeen: 1,
      firstReceivedAt: DAY_1,
      lastReceivedAt: DAY_1,
    });
    expect(stored.installations[0].latest).toEqual(withSdks);
    expect(stored.heartbeats[0]).toMatchObject({ day: '2026-09-29' });
  });

  it('accepts a content type with a charset', async () => {
    const response = await send(
      heartbeat(),
      DAY_1,
      'application/json; charset=utf-8',
    );

    expect(response.status).toBe(204);
  });
});

describe('rejected requests store nothing', () => {
  it('400 on an invalid payload, listing field paths only', async () => {
    const response = await send(
      heartbeat({ mode: 'staging', hostname: 'acme-prod-1' }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalid');
    expect(body.issues).toEqual(expect.arrayContaining(['mode']));
    expect(JSON.stringify(body)).not.toContain('acme-prod-1');
    expect(JSON.stringify(body)).not.toContain('staging');
    expect((await rows()).installations).toHaveLength(0);
  });

  it('400 on malformed JSON', async () => {
    const response = await send('{"schema_version": 1,');

    expect(response.status).toBe(400);
    expect((await rows()).installations).toHaveLength(0);
  });

  it('415 on a non-JSON content type', async () => {
    const response = await send(heartbeat(), DAY_1, 'text/plain');

    expect(response.status).toBe(415);
    expect((await rows()).installations).toHaveLength(0);
  });
});

describe('one heartbeat per installation per day', () => {
  it('a second heartbeat the same day replaces the payload', async () => {
    await send(heartbeat());
    const updated = heartbeat();
    updated.usage.flags.total = 5;

    await send(updated, DAY_1_LATER);

    const stored = await rows();
    expect(stored.heartbeats).toHaveLength(1);
    expect(stored.heartbeats[0].payload.usage.flags.total).toBe(5);
    expect(stored.installations[0]).toMatchObject({
      daysSeen: 1,
      lastReceivedAt: DAY_1_LATER,
    });
    expect(stored.installations[0].latest.usage.flags.total).toBe(5);
  });

  it('a heartbeat on a new day adds a row and counts the day', async () => {
    await send(heartbeat());

    await send(heartbeat(), DAY_2);

    const stored = await rows();
    expect(stored.heartbeats.map((row) => row.day).sort()).toEqual([
      '2026-09-29',
      '2026-09-30',
    ]);
    expect(stored.installations[0]).toMatchObject({
      daysSeen: 2,
      firstReceivedAt: DAY_1,
      lastReceivedAt: DAY_2,
    });
  });

  it('the day comes from the server clock, not sent_at', async () => {
    await send(heartbeat({ sent_at: '2026-09-26T08:00:00+00:00' }));

    expect((await rows()).heartbeats[0].day).toBe('2026-09-29');
  });

  it('concurrent heartbeats from one installation keep one row each', async () => {
    const other = createDatabase(
      process.env.TEST_DATABASE_URL ??
        'postgres://telemetry:telemetry@localhost:5433/telemetry_test',
    );
    try {
      const responses = await Promise.all([
        handleHeartbeat(post(heartbeat()), testDb, DAY_1),
        handleHeartbeat(post(heartbeat()), other, DAY_1),
        handleHeartbeat(post(heartbeat()), testDb, DAY_1),
        handleHeartbeat(post(heartbeat()), other, DAY_1),
      ]);

      expect(responses.map((response) => response.status)).toEqual([
        204, 204, 204, 204,
      ]);
      const stored = await rows();
      expect(stored.installations).toHaveLength(1);
      expect(stored.heartbeats).toHaveLength(1);
      expect(stored.installations[0].daysSeen).toBe(1);
    } finally {
      await other.$client.end();
    }
  });

  it('separate installations are stored separately', async () => {
    await send(heartbeat());
    await send(
      heartbeat({ installation_id: '0f5a9c3e-8b1d-4e2f-9a6b-3c7d8e9f0a1b' }),
    );

    expect((await rows()).installations).toHaveLength(2);
    const [first] = await testDb
      .select()
      .from(installations)
      .where(eq(installations.id, ID));
    expect(first.daysSeen).toBe(1);
  });
});

describe('health', () => {
  it('200 when the database answers', async () => {
    expect((await handleHealth(testDb)).status).toBe(200);
  });

  it('503 when the database is unreachable', async () => {
    const unreachable = createDatabase(
      'postgres://telemetry:telemetry@127.0.0.1:1/telemetry?connect_timeout=1',
    );
    try {
      expect((await handleHealth(unreachable)).status).toBe(503);
    } finally {
      await unreachable.$client.end({ timeout: 0 });
    }
  });
});
