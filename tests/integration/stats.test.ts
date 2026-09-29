/**
 * Aggregates against seeded installations. Every published number must count
 * installations (one vote each), hide groups under K, and ignore one-day
 * installs and installs that went quiet.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { heartbeats, installations } from '@/lib/db/schema';
import type { HeartbeatV1 } from '@/lib/schema/v1';
import { SMALL } from '@/lib/stats/fold';
import { computeStats } from '@/lib/stats/query';
import withSdks from '../fixtures/with-sdks.json';
import { resetDatabase, testDb } from './database';

const NOW = new Date('2026-09-29T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

type Seed = {
  /** Days before NOW on which a heartbeat was received; defaults to [1, 0]. */
  days?: number[];
  change?: (payload: HeartbeatV1) => void;
};

async function seed({ days = [1, 0], change }: Seed = {}) {
  const payload = structuredClone(withSdks) as HeartbeatV1;
  payload.installation_id = randomUUID();
  change?.(payload);
  const received = days.map(daysAgo).sort((a, b) => a.getTime() - b.getTime());
  await testDb.insert(installations).values({
    id: payload.installation_id,
    firstSeenAt: received[0],
    firstReceivedAt: received[0],
    lastReceivedAt: received[received.length - 1],
    daysSeen: received.length,
    latest: payload,
  });
  await testDb.insert(heartbeats).values(
    received.map((at) => ({
      installationId: payload.installation_id,
      day: at.toISOString().slice(0, 10),
      receivedAt: at,
      payload,
    })),
  );
  return payload.installation_id;
}

async function seedMany(count: number, options: Seed = {}) {
  for (let i = 0; i < count; i++) await seed(options);
}

function mode(value: HeartbeatV1['mode']) {
  return (payload: HeartbeatV1) => {
    payload.mode = value;
  };
}

beforeEach(resetDatabase);
afterAll(() => testDb.$client.end());

describe('headline', () => {
  it('splits established active installs by mode', async () => {
    await seedMany(6, { change: mode('production') });
    await seedMany(7, { change: mode('development') });

    const stats = await computeStats(testDb, NOW);

    expect(stats.headline.active_7d).toEqual({ production: 6, development: 7 });
    expect(stats.headline.active_30d).toEqual({
      production: 6,
      development: 7,
    });
  });

  it('counts one-day installs only as new and unconfirmed', async () => {
    await seedMany(20, { days: [2] });

    const stats = await computeStats(testDb, NOW);

    expect(stats.headline.active_7d).toEqual({ production: 0, development: 0 });
    expect(stats.headline.new_unconfirmed_7d).toBe(20);
  });

  it('drops installs that went quiet', async () => {
    await seed({ days: [50, 40] });
    await seed({ days: [20, 10], change: mode('production') });

    const stats = await computeStats(testDb, NOW);

    expect(stats.headline.active_7d).toEqual({ production: 0, development: 0 });
    expect(stats.headline.active_30d).toEqual({
      production: 1,
      development: 0,
    });
  });
});

describe('not enough data', () => {
  it('publishes the headline but no breakdowns below K installs', async () => {
    await seedMany(3, { change: mode('production') });

    const stats = await computeStats(testDb, NOW);

    expect(stats.enough_data).toBe(false);
    expect(stats.headline.active_7d.production).toBe(3);
    expect(stats.breakdowns).toBeUndefined();
    expect(stats.sdks).toBeUndefined();
    expect(stats.features).toBeUndefined();
  });
});

describe('one installation, one vote', () => {
  it('an absurd install does not move the median or appear anywhere', async () => {
    for (let flags = 1; flags <= 10; flags++) {
      await seed({
        change: (payload) => {
          payload.usage.flags.total = flags * 2;
        },
      });
    }
    await seed({
      change: (payload) => {
        payload.usage.flags.total = 1_000_000;
      },
    });

    const stats = await computeStats(testDb, NOW);

    expect(stats.features?.median_flags).toBeGreaterThanOrEqual(2);
    expect(stats.features?.median_flags).toBeLessThanOrEqual(20);
    expect(JSON.stringify(stats)).not.toContain('1000000');
  });

  it('feature adoption is the percentage of installs', async () => {
    await seedMany(3, {
      change: (payload) => {
        payload.usage.flags.multivariate = 4;
        payload.usage.rules_with_rollout = 1;
      },
    });
    await seedMany(7, {
      change: (payload) => {
        payload.usage.flags.multivariate = 0;
        payload.usage.rules_with_rollout = 0;
        payload.usage.active_overrides = 0;
      },
    });

    const stats = await computeStats(testDb, NOW);

    expect(stats.features?.multivariate_percent).toBe(30);
    expect(stats.features?.rollout_percent).toBe(30);
    expect(stats.features?.active_override_percent).toBe(30);
  });
});

describe('breakdowns', () => {
  it('folds rare versions into other', async () => {
    const version = (value: string) => (payload: HeartbeatV1) => {
      payload.flagward_version = value;
    };
    await seedMany(12, { change: version('0.6.0') });
    await seedMany(6, { change: version('0.5.0') });
    await seedMany(2, { change: version('0.4.1') });

    const stats = await computeStats(testDb, NOW);

    expect(stats.breakdowns?.flagward_version).toEqual([
      { value: '0.6.0', installs: 12 },
      { value: '0.5.0', installs: 6 },
      { value: 'other', installs: SMALL },
    ]);
  });

  it('reports runtime and evaluation-volume breakdowns', async () => {
    await seedMany(5, {
      change: (payload) => {
        payload.runtime.deployment = 'docker';
        payload.runtime.database = 'postgresql';
        payload.runtime.redis_enabled = true;
        payload.evaluations_24h_bucket = '1k-10k';
      },
    });
    await seedMany(6, {
      change: (payload) => {
        payload.runtime.deployment = 'bare';
        payload.runtime.database = 'sqlite';
        payload.runtime.redis_enabled = false;
        payload.evaluations_24h_bucket = '0';
      },
    });

    const breakdowns = (await computeStats(testDb, NOW)).breakdowns;

    expect(breakdowns?.deployment).toEqual([
      { value: 'bare', installs: 6 },
      { value: 'docker', installs: 5 },
    ]);
    expect(breakdowns?.database).toEqual([
      { value: 'sqlite', installs: 6 },
      { value: 'postgresql', installs: 5 },
    ]);
    expect(breakdowns?.redis_enabled).toEqual([
      { value: 'false', installs: 6 },
      { value: 'true', installs: 5 },
    ]);
    expect(breakdowns?.evaluations_24h_bucket).toEqual([
      { value: '0', installs: 6 },
      { value: '1k-10k', installs: 5 },
    ]);
  });

  it('only counts established installs active in the last 30 days', async () => {
    await seedMany(5);
    await seedMany(10, { days: [0] });
    await seedMany(10, { days: [60, 45] });

    const stats = await computeStats(testDb, NOW);

    expect(stats.breakdowns?.deployment).toEqual([
      { value: 'bare', installs: 5 },
    ]);
  });
});

describe('sdks', () => {
  const sdks =
    (...types: [string, string][]) =>
    (payload: HeartbeatV1) => {
      payload.sdks = types.map(([type, version]) => ({
        type,
        version,
        active_7d: 1,
      }));
    };

  it('reports adoption as a percentage of installs and hides rare types', async () => {
    await seedMany(6, { change: sdks(['react', '0.4.0'], ['vue', '0.3.0']) });
    await seedMany(2, { change: sdks(['angular', '0.1.0']) });
    await seedMany(2, { change: sdks() });

    const stats = await computeStats(testDb, NOW);

    expect(stats.sdks?.adoption).toEqual([
      { type: 'react', percent: 60 },
      { type: 'vue', percent: 60 },
      { type: 'other', percent: SMALL },
    ]);
    expect(JSON.stringify(stats)).not.toContain('angular');
  });

  it('reports versions per published type, folded', async () => {
    await seedMany(5, { change: sdks(['react', '0.4.0']) });
    await seedMany(3, { change: sdks(['react', '0.3.0']) });

    const stats = await computeStats(testDb, NOW);

    expect(stats.sdks?.versions.react).toEqual([
      { value: '0.4.0', installs: 5 },
      { value: 'other', installs: SMALL },
    ]);
  });
});

describe('weekly active installs', () => {
  it('counts distinct established installs per ISO week', async () => {
    // 2026-09-29 is a Tuesday in ISO week 40.
    await seedMany(3, { days: [8, 1] }); // W39 and W40
    await seedMany(2, { days: [1, 0] }); // W40 only

    const weekly = (await computeStats(testDb, NOW)).weekly_active;

    expect(weekly).toEqual([
      { week: '2026-W39', installs: 3 },
      { week: '2026-W40', installs: 5 },
    ]);
  });

  it('ignores weeks older than 52 weeks', async () => {
    await seedMany(1, { days: [400, 380] });

    expect((await computeStats(testDb, NOW)).weekly_active).toEqual([]);
  });
});

describe('shape', () => {
  it('matches the /v1/stats contract in design.md', async () => {
    await seedMany(5);

    const stats = await computeStats(testDb, NOW);

    expect(Object.keys(stats).sort()).toEqual([
      'breakdowns',
      'enough_data',
      'features',
      'generated_at',
      'headline',
      'k',
      'sdks',
      'weekly_active',
    ]);
    expect(Object.keys(stats.breakdowns ?? {}).sort()).toEqual([
      'database',
      'deployment',
      'email_configured',
      'evaluations_24h_bucket',
      'flagward_version',
      'redis_enabled',
    ]);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
  });
});

describe('metadata', () => {
  it('stamps generation time and K', async () => {
    const stats = await computeStats(testDb, NOW);

    expect(stats.generated_at).toBe(NOW.toISOString());
    expect(stats.k).toBe(5);
  });
});
