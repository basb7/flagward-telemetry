# Exploration: Telemetry Collector

**Date**: 2026-09-29
**Change**: telemetry-collector

## Question

What must exist at `telemetry.flagward.com` so the heartbeats Flagward installations already send (basb7/flagward#67) are received, stored safely, and turned into a public stats page?

## What the sender already does (fixed contract)

- `POST https://telemetry.flagward.com/v1/heartbeat`, JSON body, `Content-Type: application/json`, `User-Agent: flagward-telemetry/<version>`.
- 3-second timeout, no retries. Any 2xx is success; the sender ignores the body.
- At most one heartbeat per installation per 24h (dedup on the sender side through the database); `manage.py telemetry --send` can send extra ones for validation.
- Payload is `schema_version: 1` as listed in `flagward/docs/telemetry.md`: installation ID (UUID4), `first_seen_at`, version, `mode`, `server`, `runtime.*`, `usage.*` counts, `sdks[]`, `evaluations_24h_bucket`.
- Installation IDs are random; a deleted database produces a new ID. Dev installs (throwaway DBs) will create many short-lived IDs.

## Constraints

- **Trust**: telemetry is on by default. The page is public on purpose: operators can see exactly what is done with their data. What is stored and published must be at least as conservative as what `docs/telemetry.md` promises.
- **The IP is the only personal datum** the collector sees. The sender docs promise it is not stored — that includes reverse-proxy access logs, not only the application database.
- **Anyone can POST**. The endpoint is unauthenticated by nature (every install is anonymous), so fake or inflated data must not be able to distort the public page.
- **Existing conventions**: `flagward-landing` and `flagward-docs` are Next.js 16 + React 19 + TypeScript, Biome, Tailwind v4, shadcn, `en`/`es` i18n, Docker multi-stage with a standalone runner, deployed with `compose.yml`.

## Findings

1. **Poisoning is the main design risk.** A single fake installation reporting `flags.total = 10^9` would dominate any sum. Public metrics must count installations (one install = one vote), use medians/buckets instead of sums, and validate numeric ranges on ingestion.
2. **Throwaway installs need filtering, not deleting.** "Active" (heartbeat in the last N days) and "established" (heartbeats on ≥ 2 distinct days) separate real installs from CI leaks, one-off `docker compose up` trials and `--send` validation runs.
3. **Small groups can identify someone.** A breakdown showing "1 install on SDK version 0.1.7-acme" is close to identifying. A minimum group size (k-anonymity threshold) folds small categories into "other".
4. **Storage is tiny.** One row per install per day. Even 10,000 installs is ~3.6M rows/year — plain PostgreSQL with a unique `(installation_id, day)` constraint is enough; no queue or analytics engine needed.
5. **Same stack as landing** lets the collector reuse Dockerfile, compose, Biome, shadcn and i18n setup, and run on the same host behind the same reverse proxy.

## Recommendation

A single Next.js app: a strict ingestion route handler writing to PostgreSQL (one row per install per day, IP never persisted), and a public, cached stats page built only from per-install aggregates with a minimum group size.
