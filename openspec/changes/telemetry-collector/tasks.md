# Tasks: Telemetry Collector

**Date**: 2026-09-29
**Status**: Draft
**Phase**: sdd-tasks
**Change**: telemetry-collector

## Delivery Gate

No commit, no GitHub repo, no deploy until the user approves and validates locally (Phase 7). Deploy (Phase 8) is a separate, explicit decision.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2,000-2,800 (new repo; ≈40% tests, plus copied landing scaffolding) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes, if reviewed as PRs; the first commit to a new repo can also land as an initial import |
| Suggested split | 1: scaffold + schema + DB → 2: ingestion → 3: stats + fold → 4: page + i18n → 5: retention + deploy |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before commit: Yes (initial import vs PR chain)

### Suggested Work Units

| Unit | Goal | Focused test command | Rollback boundary |
|------|------|----------------------|-------------------|
| 1 | Scaffold, schema v1, DB schema + migrations | `npx vitest run tests/unit/schema` | `lib/schema`, `lib/db`, `drizzle/` |
| 2 | `POST /v1/heartbeat`, `/health` | `npx vitest run tests/integration/ingest` | `app/v1/heartbeat`, `app/health`, `lib/ingest.ts` |
| 3 | `getStats()`, fold, `/v1/stats` | `npx vitest run tests/integration/stats tests/unit/fold` | `lib/stats`, `app/v1/stats` |
| 4 | Public page + i18n + proxy exclusions | `npm run lint && npm run build` + proxy test | `app/[lang]`, `components/stats`, `i18n`, `proxy.ts` |
| 5 | Retention, Docker, compose, Nginx vhost, README | `npx vitest run tests/integration/retention` + `docker compose up` | `scripts/`, `Dockerfile`, `compose*.yml`, `deploy/` |

## Phase 1: Scaffold

- [x] 1.1 Create Next.js 16 app (TypeScript, App Router, Tailwind v4) matching `flagward-landing`: `biome.json`, `components.json` (shadcn), `tsconfig.json`, `.gitignore`, `postcss.config.mjs`
- [x] 1.2 Read `node_modules/next/dist/docs/` for route handlers, `"use cache"`/`cacheLife` and `proxy.ts`; note deviations from the design in `design.md`
- [x] 1.3 Add Vitest; `compose.dev.yml` with PostgreSQL 18 (port 5433) for local dev and tests; `.env.example` (`DATABASE_URL`, `TEST_DATABASE_URL`, `TELEMETRY_PORT`)
- [x] 1.4 Add Drizzle + `postgres` driver; `lib/db/client.ts`

## Phase 2: Schema and Storage

- [x] 2.1 Copy fixtures from a real Flagward payload (`manage.py telemetry --show`) into `tests/fixtures/` (valid, with SDKs, empty install)
- [x] 2.2 RED: schema v1 accepts every fixture
- [x] 2.3 RED: one rejection test per rule in the heartbeat-ingestion spec table; unknown top-level and nested keys; missing field; `schema_version: 2`; count > 1,000,000; `sdks` > 50 items
- [x] 2.4 RED: new SDK type `angular` and plan `ENTERPRISE` accepted (shape, not allowlist)
- [x] 2.5 GREEN: `lib/schema/v1.ts` (Zod, `.strict()` at every level)
- [x] 2.6 `lib/db/schema.ts` (`installations`, `heartbeats`), generate migration, review the SQL against the design

## Phase 3: Ingestion

- [x] 3.1 RED: valid POST → 204, empty body; one `installations` + one `heartbeats` row
- [x] 3.2 RED: invalid payload → 400 with field paths only (no values echoed); nothing stored
- [x] 3.3 RED: malformed JSON → 400; `text/plain` → 415; GET → 405
- [x] 3.4 RED: second heartbeat same day replaces the payload; `days_seen` unchanged
- [x] 3.5 RED: heartbeat on a new day → new row, `days_seen` + 1, `first_received_at` unchanged
- [x] 3.6 RED: `sent_at` three days ago → stored under today (UTC)
- [x] 3.7 RED: two concurrent heartbeats from one install → one row each table
- [x] 3.8 GREEN: `lib/ingest.ts` (transaction, both `ON CONFLICT` upserts, `xmax = 0` new-day detection) + `app/v1/heartbeat/route.ts`
- [x] 3.9 RED → GREEN: `/health` 200 with DB, 503 without

## Phase 4: Stats

- [x] 4.1 RED: `fold()` — categories < K → `other`; `other` < K → `"< 5"`; population < K → `enough_data: false`
- [x] 4.2 GREEN: `lib/stats/fold.ts`
- [x] 4.3 RED: headline active_7d / active_30d split by mode; one-day installs only in `new_unconfirmed_7d`; install last seen 40 days ago excluded
- [x] 4.4 RED: median flags unaffected by one install reporting 1,000,000; no published number ≥ 1,000,000
- [x] 4.5 RED: feature adoption % (multivariate, rollout, active override); SDK adoption % and versions per type
- [x] 4.6 RED: version / deployment / database / redis / email / evaluation-bucket breakdowns, folded
- [x] 4.7 RED: weekly series — distinct established installs per ISO week, 52 weeks
- [x] 4.8 GREEN: `lib/stats/query.ts` + `getStats()` with 15-minute cache
- [x] 4.9 RED → GREEN: `GET /v1/stats` returns `getStats()` with `generated_at`; shape matches design

## Phase 5: Public Page

- [x] 5.1 Copy `i18n/` and `proxy.ts` from the landing; RED → GREEN: matcher excludes `/v1/*`, `/health`, `/_next/*`, static files
- [x] 5.2 `app/[lang]/page.tsx` rendering `getStats()`: headline cards, weekly chart, breakdown bars, SDK and feature adoption, "not enough data" state
- [x] 5.3 Transparency section: what is collected, IPs never stored, `FLAGWARD_TELEMETRY=false`, links to `flagward/docs/telemetry.md` and `/v1/stats`
- [x] 5.4 `en` / `es` dictionaries; brand assets from the landing (favicon, logo)
- [x] 5.5 `npm run lint`, `npm run build`

## Phase 6: Retention and Deploy Artifacts

- [x] 6.1 RED: retention deletes heartbeats > 13 months, keeps 12 months; deletes installations last received > 13 months (cascade)
- [x] 6.2 GREEN: `scripts/retention.ts`
- [x] 6.3 `Dockerfile` (multi-stage, standalone, like the landing) + build of the retention script
- [x] 6.4 `compose.yml`: `app` (`127.0.0.1:${TELEMETRY_PORT:-3100}:3000`), `db` (PostgreSQL 18, volume), `retention` (daily loop), migrations on start
- [x] 6.5 `deploy/nginx/telemetry.flagward.com.conf` exactly as designed
- [x] 6.6 README: what this is, local dev, deploy steps (DNS, certbot, vhost, compose), privacy checklist
- [x] 6.7 Full `vitest run`, `npm run lint`, `npm run build`

## Phase 7: Local Validation (user)

- [x] 7.1 `docker compose up`; `curl` a fixture → 204; bad payload → 400; `/health` → 200
- [x] 7.2 From the local Flagward: `FLAGWARD_TELEMETRY=true FLAGWARD_TELEMETRY_URL=http://localhost:3100/v1/heartbeat manage.py telemetry --send` → `HTTP 204`
- [x] 7.3 Same again → still one heartbeat row for today
- [x] 7.4 Page at `/en` and `/es`: "not enough data" with < 5 installs; seed script with ≥ 5 established installs → breakdowns appear, rare values as `other`
- [x] 7.5 `/v1/stats` numbers equal the page
- [x] 7.6 User approves → decide import/PR split and GitHub repo creation

## Phase 8: Deploy (separate decision)

- [ ] 8.1 DNS `telemetry.flagward.com` → VPS
- [ ] 8.2 Install vhost, `certbot --nginx -d telemetry.flagward.com`, `nginx -t`, reload
- [ ] 8.3 `docker compose up -d` on the VPS
- [ ] 8.4 From a local Flagward: `--send` with the default URL → `HTTP 204`
- [ ] 8.5 Privacy check: POST from a known IP, then grep Nginx logs, app logs and DB for it → nothing
- [ ] 8.6 Nginx 413 (20 KB body) and 429 (burst) verified
- [ ] 8.7 Lift the flagward release gate
