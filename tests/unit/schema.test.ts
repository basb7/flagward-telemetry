/**
 * Schema v1 is the contract with Flagward's `telemetry/payload.py`. Every
 * fixture is a payload a real installation produced; every rejection below is
 * one row of the field table in specs/heartbeat-ingestion/spec.md.
 */
import { describe, expect, it } from 'vitest';
import { heartbeatV1 } from '@/lib/schema/v1';
import dockerProduction from '../fixtures/docker-production.json';
import emptyInstall from '../fixtures/empty-install.json';
import withSdks from '../fixtures/with-sdks.json';

type Json = Record<string, unknown>;

function payload(): Json {
  return structuredClone(withSdks) as Json;
}

/** Sets (or deletes, with `undefined`) a dotted path on a fresh valid payload. */
function withField(path: string, value: unknown): Json {
  const data = payload();
  const keys = path.split('.');
  let node = data as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
  return data;
}

function accepts(data: unknown) {
  return heartbeatV1.safeParse(data).success;
}

describe('schema v1: real payloads', () => {
  it.each([
    ['empty-install', emptyInstall],
    ['with-sdks', withSdks],
    ['docker-production', dockerProduction],
  ])('accepts %s', (_name, fixture) => {
    const result = heartbeatV1.safeParse(fixture);
    expect(result.error?.issues).toBeUndefined();
  });
});

describe('schema v1: unknown and missing fields', () => {
  it('rejects an unknown top-level field', () => {
    expect(accepts({ ...payload(), hostname: 'acme-prod-1' })).toBe(false);
  });

  it.each(['runtime', 'usage', 'usage.flags'])(
    'rejects an unknown field inside %s',
    (path) => {
      expect(accepts(withField(`${path}.extra`, 1))).toBe(false);
    },
  );

  it('rejects an unknown field inside an sdk entry', () => {
    const data = payload();
    (data.sdks as Json[])[0].app_name = 'acme';
    expect(accepts(data)).toBe(false);
  });

  it.each([
    'schema_version',
    'installation_id',
    'mode',
    'runtime.python',
    'usage.flags.total',
    'sdks',
    'evaluations_24h_bucket',
  ])('rejects a payload missing %s', (path) => {
    expect(accepts(withField(path, undefined))).toBe(false);
  });
});

describe('schema v1: field rules', () => {
  it.each<[string, unknown]>([
    ['schema_version', 2],
    ['schema_version', '1'],
    ['installation_id', 'not-a-uuid'],
    ['sent_at', 'yesterday'],
    ['sent_at', '2026-09-29T16:44:37'],
    ['first_seen_at', 12345],
    ['flagward_version', 'latest'],
    ['flagward_version', `1.0.0-${'x'.repeat(64)}`],
    ['mode', 'staging'],
    ['server', 'uvicorn'],
    ['runtime.python', '3'],
    ['runtime.django', '6.1.2'],
    ['runtime.deployment', 'kubernetes'],
    ['runtime.database', 'Postgre SQL'],
    ['runtime.redis_enabled', 'yes'],
    ['runtime.email_configured', 1],
    ['runtime.default_plan', 'plan with spaces'],
    ['usage.organizations', -1],
    ['usage.projects', 1.5],
    ['usage.users', 1_000_001],
    ['usage.flags.total', 1_000_000_000],
    ['usage.active_overrides', '3'],
    ['evaluations_24h_bucket', '5000'],
    ['sdks', 'react'],
  ])('rejects %s = %j', (path, value) => {
    expect(accepts(withField(path, value))).toBe(false);
  });

  it.each<[string, unknown]>([
    ['type', 'Angular'],
    ['type', 'x'.repeat(33)],
    ['version', 'build-42'],
    ['active_7d', 100_001],
    ['active_7d', -1],
  ])('rejects sdks[].%s = %j', (field, value) => {
    const data = payload();
    (data.sdks as Json[])[0][field] = value;
    expect(accepts(data)).toBe(false);
  });

  it('rejects more than 50 sdk entries', () => {
    const sdks = Array.from({ length: 51 }, () => ({
      type: 'react',
      version: '0.4.0',
      active_7d: 1,
    }));
    expect(accepts(withField('sdks', sdks))).toBe(false);
  });

  it('accepts the edge values', () => {
    const data = withField('usage.flags.total', 1_000_000);
    expect(accepts(data)).toBe(true);
    expect(accepts(withField('usage.organizations', 0))).toBe(true);
    expect(accepts(withField('flagward_version', 'unknown'))).toBe(true);
    expect(accepts(withField('flagward_version', '0.7.0-rc.1+build.5'))).toBe(
      true,
    );
  });
});

describe('schema v1: forward compatibility', () => {
  it('accepts an SDK type a newer Flagward knows', () => {
    const data = payload();
    (data.sdks as Json[])[0].type = 'angular';
    expect(accepts(data)).toBe(true);
  });

  it('accepts a plan a newer Flagward knows', () => {
    expect(accepts(withField('runtime.default_plan', 'ENTERPRISE'))).toBe(true);
  });

  it('accepts a database vendor Flagward does not ship today', () => {
    expect(accepts(withField('runtime.database', 'mysql'))).toBe(true);
  });
});
