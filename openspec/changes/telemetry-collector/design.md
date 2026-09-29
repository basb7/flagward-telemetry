# Design: Telemetry Collector

**Date**: 2026-09-29
**Status**: Draft
**Phase**: sdd-design
**Change**: telemetry-collector

## Technical Approach

One Next.js 16 app, deployed exactly like `flagward-landing`: Docker multi-stage image with standalone output, `compose.yml` with the app and PostgreSQL, Nginx on the same VPS terminating TLS (certbot / Let's Encrypt) and proxying to the container's port.

- Route handlers: `POST /v1/heartbeat`, `GET /v1/stats`, `GET /health`.
- A server-rendered, cached page at `/[lang]`.
- Nginx is the only component that sees the client IP; it enforces size and rate limits and forwards no IP headers.

> Next.js 16 differs from earlier versions (see `flagward-landing/AGENTS.md`). Route handler, caching (`"use cache"` / `cacheLife`) and proxy APIs named below MUST be checked against `node_modules/next/dist/docs/` during apply.

## Next.js 16 Findings (apply task 1.2)

Checked against `node_modules/next/dist/docs/` (Next 16.3.4):

- `"use cache"` + `cacheLife` require `cacheComponents: true` in `next.config.ts`.
- With Cache Components, a `use cache` function reached during prerender is filled **at build time**. The Docker build has no database, so the page and `GET /v1/stats` MUST call `await connection()` (from `next/server`) before `getStats()`, deferring to request time. The cache still applies at runtime.
- Self-hosted, cached entries live in the process's in-memory LRU and persist across requests; one container means one computation per window. Entries do not survive a redeploy (acceptable).
- `cacheLife({ revalidate: 900, expire: 3600 })` = stale-while-revalidate: after 15 minutes the next request is served the cached result and triggers a background refresh. The spec's "at most once every 15 minutes" holds.
- `getStats()` is split: `lib/stats/query.ts` `computeStats(db, now)` (plain, tested under Vitest) and `lib/stats/index.ts` (`'use cache'` wrapper, not unit-tested — `next/cache` needs the Next runtime).
- `proxy.ts` exports `proxy(request)` and `config.matcher`, same as the landing.
- Node 24 LTS instead of the landing's Node 20 (EOL April 2026; Vitest 5 requires ≥ 22): `engines.node >= 24`, `node:24-alpine` image.
- `drizzle-kit` pulls 4 moderate advisories via `@esbuild-kit` (dev tooling only, not in the runtime image). Revisit when drizzle-kit 1.0 is stable.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| App shape | One Next.js app for ingestion + page + JSON | Separate API service (Go/Python) + static page | Same stack, Dockerfile, Biome, shadcn and i18n as the landing; ingestion is one small handler, not worth a second runtime. |
| Validation | Zod schema with `.strict()` at every object level, one module `lib/schema/v1.ts` | Hand-written checks; JSON Schema + ajv | Strict object mode gives "unknown field → 400" for free; the inferred type is reused by storage and tests. |
| DB access | Drizzle ORM + drizzle-kit migrations, `postgres` driver | Prisma; raw SQL + custom runner | Thin, SQL-shaped, no engine binary in the image; migrations are plain SQL files that can be reviewed. |
| Upsert | `INSERT ... ON CONFLICT (installation_id, day) DO UPDATE` and `INSERT ... ON CONFLICT (id) DO UPDATE` in one transaction | Read-then-write | Atomic under concurrent heartbeats from one install; no race window. |
| Day | `(now() AT TIME ZONE 'UTC')::date` computed in SQL | Client `sent_at` | The client clock is not trusted; the server clock is one clock. |
| Rate / size limits | Nginx `limit_req_zone $binary_remote_addr zone=hb:10m rate=10r/m; limit_req zone=hb burst=20 nodelay;` + `client_max_body_size 16k` on `/v1/heartbeat` | In-app limiter | Keeps the IP out of the app entirely. Legit installs send once a day; 10/min per IP covers NAT'd fleets and `--send` testing. |
| IP forwarding | `proxy_set_header X-Forwarded-For "";` `proxy_set_header X-Real-IP "";` `proxy_set_header Forwarded "";` | Forward and ignore | "Can't store what you never receive." |
| Proxy logs | `access_log off;` and `error_log /var/log/nginx/telemetry.error.log crit;` for this vhost | Custom `log_format` without `$remote_addr` | `error_log` lines carry `client: <ip>` and cannot be reformatted; `crit` keeps only fatal proxy errors. Diagnostics come from app logs (which never see IPs) and `/health`. |
| Locale routing | Reuse landing's `proxy.ts` + `i18n/` (`en`, `es`), matcher excludes `/v1/*`, `/health`, `/_next/*` and static files | Separate subdomain for API | The sender posts to `/v1/heartbeat` with `urllib`, which does not follow redirects for POST; a locale redirect would silently drop every heartbeat. |
| Aggregates | SQL over `installations` (latest payload JSONB), one row per install; medians via `percentile_disc(0.5)` | Materialized views; pre-aggregated daily tables | Data is small (one row per install); straightforward queries are fast and easy to test. Revisit if > 100k installs. |
| "Established" | `EXISTS` ≥ 2 distinct `day` in `heartbeats` for the install; denormalized as `installations.days_seen` incremented on the first heartbeat of each day | Compute from heartbeats on every query | Avoids a join per aggregate; the upsert knows whether the day row was new (`xmax = 0`). |
| K folding | Applied in the aggregation layer (`lib/stats/fold.ts`) before results leave it; page and JSON both consume folded results | Fold in the UI | One place enforces privacy; neither view can accidentally show raw categories. |
| Caching | Aggregates function cached with a 15-minute lifetime (`"use cache"` + `cacheLife`, verified in apply); page and `/v1/stats` both call it | Cache headers only | Guarantees one computation per window across page and JSON, so they always agree. |
| Retention | `scripts/retention.ts` run daily by a tiny `retention` compose service (`node dist/retention.js` in a sleep-24h loop), plain `DELETE` statements | Lazy delete on ingestion; host cron | Keeps deletes out of the request path and needs no host cron config; restart-safe and idempotent. |
| Tests | Vitest; integration tests against a real PostgreSQL (compose service locally, `services: postgres` in CI) | Mocked DB | The upserts, `ON CONFLICT` and percentile queries are the logic; mocking them would test nothing. |

## Data Model

```sql
CREATE TABLE installations (
  id                uuid PRIMARY KEY,
  first_seen_at     timestamptz NOT NULL,        -- client-reported, informational only
  first_received_at timestamptz NOT NULL DEFAULT now(),
  last_received_at  timestamptz NOT NULL DEFAULT now(),
  days_seen         integer     NOT NULL DEFAULT 1,
  latest            jsonb       NOT NULL           -- last accepted payload, schema v1
);
CREATE INDEX installations_last_received_idx ON installations (last_received_at);

CREATE TABLE heartbeats (
  installation_id uuid        NOT NULL REFERENCES installations (id) ON DELETE CASCADE,
  day             date        NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  payload         jsonb       NOT NULL,
  PRIMARY KEY (installation_id, day)
);
CREATE INDEX heartbeats_day_idx ON heartbeats (day);
```

No column anywhere holds an IP, user agent or request header.

## Data Flow

### Ingestion

```
client ──HTTPS──▶ Nginx
                   ├─ body > 16 KB           → 413
                   ├─ rate exceeded          → 429
                   └─ strip IP headers, proxy → app :3000
                                               POST /v1/heartbeat
                                               ├─ content-type ≠ json → 415
                                               ├─ JSON.parse fails     → 400
                                               ├─ v1.safeParse fails   → 400 { error: "invalid", issues: [paths only] }
                                               └─ transaction:
                                                    upsert heartbeats (id, today) → isNewDay
                                                    upsert installations (latest, last_received_at,
                                                                          days_seen += isNewDay)
                                                  → 204
```

400 responses list only the failing field paths, never echo values.

### Stats

```
GET /[lang]  ─┐
GET /v1/stats ┴─▶ getStats()  [cached 15 min]
                    ├─ population = installations
                    │     WHERE days_seen >= 2 AND last_received_at > now() - 30 days
                    ├─ headline: active_7d / active_30d by latest->>'mode'
                    ├─ new_unconfirmed_7d: days_seen = 1 AND first_received_at > now() - 7 days
                    ├─ breakdowns (versions, deployment, database, redis, email, eval buckets)
                    ├─ sdk adoption: % installs with jsonb_path_exists(latest, '$.sdks[*] ? (@.type == $t)')
                    ├─ feature adoption: % installs with multivariate > 0 / rules_with_rollout > 0 / active_overrides > 0
                    ├─ median flags per install
                    ├─ weekly series: distinct established installs per ISO week from heartbeats (52 weeks)
                    └─ fold(K = 5) ─▶ StatsV1 (typed) ─▶ page | JSON
```

## `/v1/stats` Shape (v1)

```json
{
  "generated_at": "2026-09-29T17:00:00Z",
  "k": 5,
  "headline": {
    "active_7d":  { "production": 42, "development": 110 },
    "active_30d": { "production": 51, "development": 160 },
    "new_unconfirmed_7d": 37
  },
  "breakdowns": {
    "flagward_version": [{ "value": "0.6.0", "installs": 30 }, { "value": "other", "installs": "< 5" }],
    "deployment": [], "database": [], "redis_enabled": [], "email_configured": [], "evaluations_24h_bucket": []
  },
  "sdks": {
    "adoption": [{ "type": "react", "percent": 38.1 }],
    "versions": { "react": [{ "value": "0.4.0", "installs": 12 }] }
  },
  "features": {
    "multivariate_percent": 22.4,
    "rollout_percent": 18.0,
    "active_override_percent": 6.2,
    "median_flags": 9
  },
  "weekly_active": [{ "week": "2026-W39", "installs": 151 }],
  "enough_data": true
}
```

When the population is below K: `enough_data: false`, breakdowns/sdks/features omitted, headline still present.

## Nginx vhost (committed as `deploy/nginx/telemetry.flagward.com.conf`)

The committed file is the source of truth. Key points, all verified with a real Nginx in front of a header-echo upstream (apply phase 6):

- `upstream telemetry_app { server 127.0.0.1:3100; }` — a literal address, not `proxy_pass $variable`, which would need a `resolver` and fail with 502.
- `access_log off;` and `error_log … crit;` for the vhost; `limit_req` rejections (logged at `error`) are hidden too.
- `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `True-Client-IP`, `CF-Connecting-IP` blanked: the upstream only ever sees Nginx's own address.
- `/v1/heartbeat`: `client_max_body_size 16k`, `limit_req … rate=10r/m burst=20 nodelay`, `limit_req_status 429`. Other paths: `client_max_body_size 1k`.
- Ships as a plain `listen 80` server; `certbot --nginx -d telemetry.flagward.com` adds TLS, as on the landing.

The container publishes `127.0.0.1:${TELEMETRY_PORT:-3100}:3000` in `compose.yml`, next to the landing (3000) on the same host. Nginx does not expand environment variables, so the port is written literally in the upstream; change both together.

## Module Layout

```
app/
  [lang]/page.tsx             # public stats page (server component)
  v1/heartbeat/route.ts       # POST ingestion
  v1/stats/route.ts           # GET JSON
  health/route.ts
components/stats/…            # shadcn cards + charts
i18n/                         # copied from landing: config.ts, dictionaries/{en,es}.json
proxy.ts                      # locale redirect, excludes /v1, /health
lib/
  schema/v1.ts                # Zod schema + type
  db/{client,schema}.ts       # Drizzle
  ingest.ts                   # validate → transaction upsert
  stats/{query,fold,index}.ts # getStats() cached
scripts/retention.ts
drizzle/                      # SQL migrations
deploy/nginx/telemetry.flagward.com.conf
tests/{fixtures,unit,integration}/
Dockerfile, compose.yml, compose.dev.yml
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | Schema v1: valid fixture passes; each rule in the spec table rejects its violation; unknown top-level and nested keys rejected; new SDK type accepted | Vitest, fixtures copied from flagward's payload output |
| Unit | `fold()`: K threshold, `other` < K → `"< 5"`, population < K → `enough_data: false` | Pure function |
| Integration | Ingestion: 204/400/415/405; nothing stored on 400; same-day replace; `sent_at` ignored for day; concurrent upserts → one row; `days_seen` increments once per day | Route handler invoked with `Request`, real Postgres |
| Integration | Stats: headline split, unconfirmed excluded, inactive excluded, median unaffected by one absurd install, adoption %, weekly series | Seeded Postgres |
| Integration | Retention deletes > 13 months, keeps 12 months, cascades | Seeded Postgres |
| Integration | `proxy.ts` does not redirect `/v1/heartbeat` or `/health` | Unit-test the matcher/config |
| E2E (manual, verify) | Flagward `manage.py telemetry --send` → deployed collector → 204; Nginx 413/429; grep logs/DB for test IP → nothing | Checklist |

## Open Questions

1. K = 5 and 13-month retention — defaults kept unless changed.
2. Flagward release gate: recommended to release the flagward version with telemetry only after this is deployed and the end-to-end check passes.
