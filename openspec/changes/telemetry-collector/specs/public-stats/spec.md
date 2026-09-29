# Public Stats Specification

## Purpose

Publish aggregate Flagward usage at `telemetry.flagward.com` (page) and `/v1/stats` (JSON) in a way that no single installation can distort and no small group can be singled out.

## Definitions

- **Active (N days)**: `last_received_at` within the last N days.
- **Established**: heartbeats received on at least 2 distinct UTC days.
- **Population**: unless stated otherwise, every published metric is computed over installations that are established AND active in the last 30 days, using each installation's latest payload.
- **K**: minimum group size, `5`.

## ADDED Requirements

### Requirement: Headline Numbers

The system MUST publish the number of established installations active in the last 7 and 30 days, each split by `mode` (production / development).

#### Scenario: Split by mode

- GIVEN 6 established production installs and 7 established development installs, all active in the last 7 days
- WHEN stats are computed
- THEN active_7d is `{production: 6, development: 7}`

#### Scenario: One-day installs are not counted

- GIVEN 20 installations that sent heartbeats on a single day only
- WHEN stats are computed
- THEN none of them appears in the headline numbers
- AND they appear only in a separate `new_unconfirmed_7d` count

#### Scenario: Inactive installs drop out

- GIVEN an established installation last received 40 days ago
- WHEN stats are computed
- THEN it is not counted in active_7d or active_30d

### Requirement: One Installation, One Vote

Every breakdown MUST count installations, and usage metrics MUST be published as medians or as the percentage of installations meeting a condition — never as sums across installations.

#### Scenario: Absurd values do not dominate

- GIVEN 10 installations with `usage.flags.total` between 1 and 20
- AND 1 installation reporting `usage.flags.total = 1000000`
- WHEN stats are computed
- THEN the median flags per installation is within the range of the 10 normal installs
- AND no published number equals or exceeds 1000000

#### Scenario: Feature adoption as a percentage of installs

- GIVEN 10 installations, 3 of which have `usage.flags.multivariate > 0`
- WHEN stats are computed
- THEN multivariate adoption is 30%

### Requirement: Minimum Group Size

Any category in a breakdown with fewer than K installations MUST be merged into `other`. If `other` itself has fewer than K installations, it MUST be published as `< 5` rather than an exact count. If the whole population is below K, breakdowns MUST NOT be published at all.

#### Scenario: Rare version folded

- GIVEN 12 installs on `0.6.0`, 6 on `0.5.0` and 2 on `0.4.1`
- WHEN the version breakdown is computed
- THEN it lists `0.6.0: 12`, `0.5.0: 6`, `other: < 5`

#### Scenario: Rare SDK type folded

- GIVEN 1 installation reporting SDK type `angular`
- WHEN the SDK breakdown is computed
- THEN `angular` does not appear by name

#### Scenario: Population too small

- GIVEN 3 established active installations in total
- WHEN stats are computed
- THEN headline numbers are published and every breakdown reports "not enough data"

### Requirement: Breakdowns Published

The system MUST publish, subject to the rules above: Flagward versions; deployment; database; Redis enabled; email configured; SDK type adoption (% of installs using each type); top SDK versions per type; % of installs with multivariate flags, rule rollouts and active overrides; median flags per install; evaluation-volume bucket distribution; weekly active established installations for the last 52 weeks.

#### Scenario: Weekly trend

- GIVEN heartbeats across the last 8 weeks
- WHEN stats are computed
- THEN the weekly series has one point per week counting distinct established installations that sent at least one heartbeat that week

### Requirement: Page and JSON Agree

`GET /v1/stats` MUST return the same aggregates rendered by the page, with a `generated_at` timestamp.

#### Scenario: Same numbers

- WHEN the page and `/v1/stats` are requested within the same cache window
- THEN every number on the page equals the corresponding field in the JSON

### Requirement: Cached Computation

Aggregates MUST be recomputed at most once every 15 minutes, regardless of traffic.

#### Scenario: Many visitors

- GIVEN 1,000 page views within 10 minutes
- WHEN they are served
- THEN aggregate queries run at most once in that window

### Requirement: Transparency on the Page

The page MUST state what is collected, that IPs are never stored, how to turn telemetry off (`FLAGWARD_TELEMETRY=false`), and link to `flagward/docs/telemetry.md` and `/v1/stats`. It MUST be available in English and Spanish.

#### Scenario: Spanish visitor

- GIVEN a browser with `Accept-Language: es`
- WHEN it visits `/`
- THEN it is redirected to `/es` and the page renders in Spanish

### Requirement: Health Check

`GET /health` MUST return `200` when the app can reach the database and `503` otherwise.

#### Scenario: Database down

- GIVEN PostgreSQL is unreachable
- WHEN `/health` is requested
- THEN the response is `503`
