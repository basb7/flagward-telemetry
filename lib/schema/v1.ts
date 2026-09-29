/**
 * Schema v1 of the Flagward installation heartbeat, the contract with
 * basb7/flagward `telemetry/payload.py` and `docs/telemetry.md`.
 *
 * Every object is strict: an unknown field rejects the whole payload instead of
 * being stored "just in case". SDK types, database vendors and plans are
 * checked by shape, not by an allowlist, so a newer Flagward that knows a new
 * SDK is not rejected; rare values are folded at publication time instead.
 */
import { z } from 'zod';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const MAX_COUNT = 1_000_000;
const MAX_SDK_ENVIRONMENTS = 100_000;
const MAX_SDK_ENTRIES = 50;

const version = z.union([
  z.literal('unknown'),
  z.string().max(64).regex(SEMVER),
]);
const majorMinor = z.string().regex(/^\d{1,3}\.\d{1,3}$/);
const count = z.int().min(0).max(MAX_COUNT);
const timestamp = z.iso.datetime({ offset: true });

export const EVALUATION_BUCKETS = [
  '0',
  '1-100',
  '100-1k',
  '1k-10k',
  '10k-100k',
  '100k+',
] as const;

export const heartbeatV1 = z.strictObject({
  schema_version: z.literal(1),
  installation_id: z.uuid(),
  sent_at: timestamp,
  first_seen_at: timestamp,
  flagward_version: version,
  mode: z.enum(['production', 'development']),
  server: z.enum(['asgi', 'wsgi', 'runserver', 'unknown']),
  runtime: z.strictObject({
    python: majorMinor,
    django: majorMinor,
    deployment: z.enum(['docker', 'bare']),
    database: z.string().regex(/^[a-z0-9_]{1,32}$/),
    redis_enabled: z.boolean(),
    email_configured: z.boolean(),
    default_plan: z.string().regex(/^[A-Za-z_]{1,32}$/),
  }),
  usage: z.strictObject({
    organizations: count,
    projects: count,
    environments: count,
    users: count,
    flags: z.strictObject({
      total: count,
      boolean: count,
      multivariate: count,
    }),
    flags_with_rules: count,
    strategy_rules: count,
    rules_with_rollout: count,
    variants: count,
    active_overrides: count,
  }),
  sdks: z
    .array(
      z.strictObject({
        type: z.string().regex(/^[a-z0-9-]{1,32}$/),
        version,
        active_7d: z.int().min(0).max(MAX_SDK_ENVIRONMENTS),
      }),
    )
    .max(MAX_SDK_ENTRIES),
  evaluations_24h_bucket: z.enum(EVALUATION_BUCKETS),
});

export type HeartbeatV1 = z.infer<typeof heartbeatV1>;
