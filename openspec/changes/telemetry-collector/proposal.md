# Proposal: Telemetry Collector

**Date**: 2026-09-29
**Status**: Draft
**Phase**: sdd-proposal
**Change**: telemetry-collector

## Intent

Flagward installations send an anonymous daily heartbeat (basb7/flagward#67), but nothing receives it yet: the default URL is a placeholder. This change builds `telemetry.flagward.com`: the endpoint that receives and stores heartbeats, and a **public** page showing aggregate usage — how many installations are active, production vs development, which versions and SDKs they run, and which features they adopt. Public on purpose: with telemetry on by default, showing everyone what is done with the data is the strongest trust signal.

## Principles (non-negotiable)

1. **Never store the IP** — not in the database, not in application logs, not in reverse-proxy access logs.
2. **One installation, one vote** — public numbers count installations; no metric may be dominated by one install's reported values.
3. **No small groups** — any breakdown category with fewer than `K = 5` established installations is folded into "other".
4. **Store only what the schema defines** — unknown fields are rejected, not stored "just in case".
5. **Public page = public data** — everything shown is also available as JSON at `/v1/stats`.

## Scope

### In Scope

- New repository `flagward-telemetry` (Next.js 16 / React 19 / TypeScript, Biome, Tailwind v4, shadcn — same conventions as `flagward-landing`)
- **Ingestion** `POST /v1/heartbeat`
  - Strict schema v1 validation: exact key set, types, enums, semver, UUID, numeric ranges (e.g. counts 0–1,000,000)
  - Body size limit (16 KB); `Content-Type: application/json` required
  - `204` on success, `400` on invalid payload; `413` (too large) and `429` (rate limited) come from Nginx
  - Upsert `installations` (first/last seen, latest snapshot) and one `heartbeats` row per `(installation_id, UTC day)` — later same-day heartbeats replace the day's row
  - Per-IP rate limit and body-size limit enforced by Nginx; the app never receives the client IP
  - Unknown `schema_version` → `400` (future versions handled by future changes)
- **Storage**: PostgreSQL with `installations` and `heartbeats` tables, migrations, retention (raw heartbeats kept 13 months, then deleted)
- **Public page** `/` (en/es)
  - Active installations (heartbeat in last 7 / 30 days), split production / development
  - Established installations (heartbeats on ≥ 2 distinct days) as the headline number
  - Weekly active installations over time
  - Distribution of Flagward versions, deployment (Docker/bare), database, Redis, email
  - SDK adoption: % of installs using each SDK type, top versions
  - Feature adoption: % of installs with multivariate flags, rule rollouts, active overrides; median flags per install
  - Evaluation volume buckets distribution
  - Link to `flagward/docs/telemetry.md` and "how to turn it off"
- **Public JSON** `GET /v1/stats` with the same aggregates the page shows
- Page and stats cached (recomputed at most every 15 minutes)
- `GET /health` for the reverse proxy / uptime checks
- Dockerfile (multi-stage, standalone) + `compose.yml` (app + PostgreSQL)
- Nginx vhost config committed in the repo (`deploy/nginx/telemetry.flagward.com.conf`): TLS, `limit_req`, `client_max_body_size 16k`, `access_log off`, no client-IP headers forwarded upstream, `error_log` at `crit`
- Tests: validation (valid/invalid/edge payloads), dedup per day, rate limit, aggregates (k-threshold, one-vote-per-install, poisoning), retention

### Out of Scope

- Private/admin panel or authentication
- Per-installation views, exports of raw data
- Alerts, emails, notifications
- Schema v2 (future change, coordinated with the sender)
- Changes to the sender in `flagward` (already done in #67)
- Telemetry from the JS SDKs

## Capabilities

### New Capabilities

- `heartbeat-ingestion`: validation, dedup, rate limiting, IP handling
- `telemetry-storage`: schema, retention
- `public-stats`: aggregates, privacy thresholds, page and JSON

## Approach

1. **One Next.js app** with route handlers for `/v1/heartbeat`, `/v1/stats`, `/health`, and a server-rendered page at `/`. Same repo layout, Dockerfile and compose shape as `flagward-landing`.
2. **Validation** with a schema library (e.g. Zod, `.strict()`), shared as the single source of truth for the v1 contract; tests use fixtures copied from `flagward`'s payload tests.
3. **Storage**: `installations(id uuid pk, first_seen_at, first_received_at, last_received_at, latest jsonb)` and `heartbeats(installation_id, day date, received_at, payload jsonb, unique(installation_id, day))`. `INSERT ... ON CONFLICT (installation_id, day) DO UPDATE`.
4. **Aggregates** computed in SQL over `installations` filtered by activity window, each install contributing once. Categories below `K` merged into "other" before leaving the database layer.
5. **Caching**: aggregates cached for 15 minutes (Next.js revalidation), so the public page never runs heavy queries per visitor.
6. **IP hygiene — the app never sees the IP**: Nginx is the only component that reads the client address.
   - Rate limit with `limit_req_zone $binary_remote_addr` (shared memory, never written to disk) and `client_max_body_size 16k`.
   - Upstream requests carry no `X-Forwarded-For` / `X-Real-IP`, so Next.js only ever sees Nginx's address; the app has no code path that could store an IP.
   - `access_log off;` for this vhost.
   - `error_log` also records `client: <ip>` on errors; set to `crit` for this vhost (tradeoff: fewer diagnostics for this host, documented). Upstream failures are still visible through the app's own logs and `/health`.
   - The vhost config lives in the repo so the privacy promise is reviewable, and the verify phase greps the host's logs for IPs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `flagward-telemetry/` (new repo) | New | Whole app |
| DNS `telemetry.flagward.com` | New | Record pointing to the host |
| Nginx on the host | Modified | New vhost (config versioned in `deploy/nginx/`), TLS, rate limit, no IP logs, no IP forwarded upstream |
| `flagward` | None | Sender already targets `/v1/heartbeat`; only the release gate lifts once this is live |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Fake installs inflate counts | Medium | "Established" (≥ 2 distinct days) as headline; rate limit; range validation |
| One install distorts metrics with huge values | Medium | One vote per install; medians and % of installs, never sums; range limits |
| IP leaks through Nginx logs | Medium | `access_log off`, `error_log crit`, versioned vhost config; verify step greps logs for IPs; stated on the page |
| Nginx default logs or a later edit re-enable IP logging | Low | Config in repo, reviewed like code; verify checklist re-run on every deploy change |
| Small categories identify an operator | Low | K = 5 threshold folded into "other" |
| Sender and collector schema drift | Medium | Shared fixtures; unknown fields rejected loudly (400) so drift is visible in tests, not silent |
| Dev/CI churn inflates install counts | High | Production/development split; "established" filter; activity windows |
| Downtime loses a day of data | Low | Acceptable by design (sender never retries); `/health` uptime check |

## Rollback Plan

The sender fails silently when the collector is down, so the collector can be stopped at any time with no impact on installations. Data rollback: drop the database; nothing else depends on it.

## Dependencies

- A host to run it (the same one as `flagward-landing` is assumed) and DNS for `telemetry.flagward.com`
- basb7/flagward#67 merged (sender) — the collector can be built and tested before, with fixtures

## Success Criteria

- [ ] `manage.py telemetry --send` from a local Flagward reaches the deployed collector and returns 204
- [ ] Invalid, oversized or unknown-field payloads are rejected with the right status
- [ ] A second heartbeat the same day updates the day's row instead of adding one
- [ ] No IP appears in the database, application logs or proxy logs for this host
- [ ] The public page and `/v1/stats` show the same numbers; categories under K are "other"
- [ ] One install reporting absurd values does not change any published median or percentage beyond its single vote
- [ ] Page renders in en and es

## Open Questions

1. ~~Hosting~~ — resolved: same VPS, Nginx and certbot/Let's Encrypt as `flagward-landing`.
2. Should the flagward release that enables telemetry wait until this is deployed? (Recommended: yes.)
3. K = 5 and 13-month retention — acceptable defaults?
