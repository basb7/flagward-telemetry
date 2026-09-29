/**
 * Public aggregates, computed over each installation's latest payload.
 *
 * Every number counts installations (one vote each): usage is published as
 * medians or as the percentage of installations meeting a condition, never as
 * a sum, so no single install can dominate. Every breakdown goes through
 * `fold()` before it leaves this module.
 */
import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  type Category,
  fold,
  K,
  OTHER,
  type PublishedCategory,
  SMALL,
} from './fold';

type ByMode = { production: number; development: number };
type Percent = number | typeof SMALL;

export type StatsV1 = {
  generated_at: string;
  k: number;
  enough_data: boolean;
  headline: {
    active_7d: ByMode;
    active_30d: ByMode;
    new_unconfirmed_7d: number;
  };
  breakdowns?: Record<BreakdownName, PublishedCategory[]>;
  sdks?: {
    adoption: { type: string; percent: Percent }[];
    versions: Record<string, PublishedCategory[]>;
  };
  features?: {
    multivariate_percent: number;
    rollout_percent: number;
    active_override_percent: number;
    median_flags: number;
  };
  weekly_active: { week: string; installs: number }[];
};

/** JSON paths into `installations.latest`; fixed constants, never user input. */
const BREAKDOWNS = {
  flagward_version: '{flagward_version}',
  deployment: '{runtime,deployment}',
  database: '{runtime,database}',
  redis_enabled: '{runtime,redis_enabled}',
  email_configured: '{runtime,email_configured}',
  evaluations_24h_bucket: '{evaluations_24h_bucket}',
} as const;

type BreakdownName = keyof typeof BREAKDOWNS;

const WEEKS = 52;

export async function computeStats(
  db: Database,
  now: Date = new Date(),
): Promise<StatsV1> {
  // Raw `sql` params go straight to the driver, which does not serialize Date.
  const at = now.toISOString();
  // Established (heartbeats on >= 2 distinct days) and active in 30 days.
  const population = sql`
    SELECT id, latest FROM installations
    WHERE days_seen >= 2
      AND last_received_at > ${at}::timestamptz - interval '30 days'
  `;

  const headline = await computeHeadline(db, at);
  const weekly_active = await computeWeekly(db, at);
  const features = await computeFeatures(db, population);

  const base = { generated_at: at, k: K, headline, weekly_active };
  if (features.total < K) {
    return { ...base, enough_data: false };
  }

  const breakdowns = {} as Record<BreakdownName, PublishedCategory[]>;
  for (const [name, path] of Object.entries(BREAKDOWNS)) {
    breakdowns[name as BreakdownName] = fold(
      await rows<Category>(
        db,
        sql`
          SELECT latest #>> ${path} AS value, count(*)::int AS installs
          FROM (${population}) population
          GROUP BY 1
        `,
      ),
    );
  }

  return {
    ...base,
    enough_data: true,
    breakdowns,
    sdks: await computeSdks(db, population, features.total),
    features: {
      multivariate_percent: percent(features.multivariate, features.total),
      rollout_percent: percent(features.rollout, features.total),
      active_override_percent: percent(features.overrides, features.total),
      median_flags: features.median ?? 0,
    },
  };
}

async function rows<T extends Record<string, unknown>>(
  db: Database,
  query: SQL,
): Promise<T[]> {
  return [...(await db.execute<T>(query))] as T[];
}

function percent(part: number, total: number): number {
  return Math.round((part * 1000) / total) / 10;
}

async function computeHeadline(db: Database, at: string) {
  const byMode = await rows<{ mode: string; d7: number; d30: number }>(
    db,
    sql`
      SELECT latest ->> 'mode' AS mode,
             count(*) FILTER (WHERE last_received_at > ${at}::timestamptz - interval '7 days')::int AS d7,
             count(*) FILTER (WHERE last_received_at > ${at}::timestamptz - interval '30 days')::int AS d30
      FROM installations
      WHERE days_seen >= 2
      GROUP BY 1
    `,
  );
  const active_7d: ByMode = { production: 0, development: 0 };
  const active_30d: ByMode = { production: 0, development: 0 };
  for (const row of byMode) {
    if (row.mode === 'production' || row.mode === 'development') {
      active_7d[row.mode] = row.d7;
      active_30d[row.mode] = row.d30;
    }
  }

  const [unconfirmed] = await rows<{ installs: number }>(
    db,
    sql`
      SELECT count(*)::int AS installs FROM installations
      WHERE days_seen = 1
        AND first_received_at > ${at}::timestamptz - interval '7 days'
    `,
  );
  return { active_7d, active_30d, new_unconfirmed_7d: unconfirmed.installs };
}

async function computeFeatures(db: Database, population: SQL) {
  const [row] = await rows<{
    total: number;
    multivariate: number;
    rollout: number;
    overrides: number;
    median: number | null;
  }>(
    db,
    sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE (latest #>> '{usage,flags,multivariate}')::int > 0)::int AS multivariate,
             count(*) FILTER (WHERE (latest #>> '{usage,rules_with_rollout}')::int > 0)::int AS rollout,
             count(*) FILTER (WHERE (latest #>> '{usage,active_overrides}')::int > 0)::int AS overrides,
             percentile_disc(0.5) WITHIN GROUP (ORDER BY (latest #>> '{usage,flags,total}')::int) AS median
      FROM (${population}) population
    `,
  );
  return row;
}

async function computeSdks(db: Database, population: SQL, total: number) {
  const installSdks = sql`
    SELECT DISTINCT population.id, sdk ->> 'type' AS type, sdk ->> 'version' AS version
    FROM (${population}) population,
         jsonb_array_elements(population.latest -> 'sdks') AS sdk
  `;

  const byType = await rows<{ type: string; installs: number }>(
    db,
    sql`
      SELECT type, count(DISTINCT id)::int AS installs
      FROM (${installSdks}) sdks
      GROUP BY 1
    `,
  );
  const published = byType
    .filter((row) => row.type !== OTHER && row.installs >= K)
    .sort((a, b) => b.installs - a.installs || a.type.localeCompare(b.type))
    .map((row) => row.type);
  // Drizzle expands JS arrays into `(a, b)` lists, so the set goes as JSON.
  const publishedJson = JSON.stringify(published);

  const adoption: { type: string; percent: Percent }[] = byType
    .filter((row) => published.includes(row.type))
    .sort((a, b) => b.installs - a.installs || a.type.localeCompare(b.type))
    .map((row) => ({ type: row.type, percent: percent(row.installs, total) }));

  // Installs using any type that is not published by name, counted once each.
  const [folded] = await rows<{ installs: number }>(
    db,
    sql`
      SELECT count(DISTINCT id)::int AS installs
      FROM (${installSdks}) sdks
      WHERE type NOT IN (SELECT jsonb_array_elements_text(${publishedJson}::jsonb))
    `,
  );
  if (folded.installs > 0) {
    adoption.push({
      type: OTHER,
      percent: folded.installs < K ? SMALL : percent(folded.installs, total),
    });
  }

  const versions: Record<string, PublishedCategory[]> = {};
  const versionRows = await rows<{
    type: string;
    value: string;
    installs: number;
  }>(
    db,
    sql`
      SELECT type, version AS value, count(DISTINCT id)::int AS installs
      FROM (${installSdks}) sdks
      WHERE type IN (SELECT jsonb_array_elements_text(${publishedJson}::jsonb))
      GROUP BY 1, 2
    `,
  );
  for (const type of published) {
    versions[type] = fold(versionRows.filter((row) => row.type === type));
  }

  return { adoption, versions };
}

async function computeWeekly(db: Database, at: string) {
  return rows<{ week: string; installs: number }>(
    db,
    sql`
      SELECT to_char(date_trunc('week', heartbeats.day), 'IYYY-"W"IW') AS week,
             count(DISTINCT heartbeats.installation_id)::int AS installs
      FROM heartbeats
      JOIN installations ON installations.id = heartbeats.installation_id
      WHERE installations.days_seen >= 2
        AND heartbeats.day > (${at}::timestamptz AT TIME ZONE 'UTC')::date - ${WEEKS * 7}::int
      GROUP BY 1
      ORDER BY 1
    `,
  );
}
