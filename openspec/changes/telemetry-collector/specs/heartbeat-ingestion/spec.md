# Heartbeat Ingestion Specification

## Purpose

Receive schema v1 heartbeats from Flagward installations at `POST /v1/heartbeat`, accept only what the contract defines, and never let the client IP reach the application.

## ADDED Requirements

### Requirement: Endpoint Contract

The system MUST accept `POST /v1/heartbeat` with a JSON body and respond `204` with an empty body when the payload is valid.

#### Scenario: Valid heartbeat

- GIVEN a payload produced by Flagward's `build_payload` (schema v1)
- WHEN it is posted with `Content-Type: application/json`
- THEN the response is `204` with no body

#### Scenario: Not redirected by locale routing

- GIVEN the locale proxy redirects unprefixed page paths to `/{locale}`
- WHEN a heartbeat is posted to `/v1/heartbeat`
- THEN it is handled directly, with no redirect

#### Scenario: Wrong method

- WHEN `GET /v1/heartbeat` is requested
- THEN the response is `405`

#### Scenario: Wrong content type

- WHEN a valid body is posted with `Content-Type: text/plain`
- THEN the response is `415`

### Requirement: Strict Schema v1 Validation

The system MUST reject any payload that does not match schema v1 exactly, with `400`, and MUST NOT store any part of a rejected payload.

Field rules (from `flagward/docs/telemetry.md`):

| Field | Rule |
|-------|------|
| `schema_version` | exactly `1` |
| `installation_id` | UUID |
| `sent_at`, `first_seen_at` | ISO 8601 datetime with offset |
| `flagward_version` | semver or `"unknown"`, ≤ 64 chars |
| `mode` | `production` \| `development` |
| `server` | `asgi` \| `wsgi` \| `runserver` \| `unknown` |
| `runtime.python`, `runtime.django` | `^\d{1,3}\.\d{1,3}$` |
| `runtime.deployment` | `docker` \| `bare` |
| `runtime.database` | `^[a-z0-9_]{1,32}$` |
| `runtime.redis_enabled`, `runtime.email_configured` | boolean |
| `runtime.default_plan` | `^[A-Za-z_]{1,32}$` |
| `usage.*` counts | integer, 0 – 1,000,000 |
| `sdks` | array, ≤ 50 items |
| `sdks[].type` | `^[a-z0-9-]{1,32}$` |
| `sdks[].version` | semver or `"unknown"`, ≤ 64 chars |
| `sdks[].active_7d` | integer, 0 – 100,000 |
| `evaluations_24h_bucket` | `0` \| `1-100` \| `100-1k` \| `1k-10k` \| `10k-100k` \| `100k+` |

`sdks[].type`, `runtime.database` and `runtime.default_plan` are validated by shape, not by an allowlist, so a newer Flagward that knows a new SDK or plan is not rejected; rare values are folded at publication time (see public-stats).

#### Scenario: Unknown field is rejected

- GIVEN a valid payload with an extra top-level key `hostname`
- WHEN it is posted
- THEN the response is `400`
- AND nothing is stored

#### Scenario: Unknown nested field is rejected

- GIVEN a valid payload with an extra key `usage.emails`
- WHEN it is posted
- THEN the response is `400`

#### Scenario: Missing field is rejected

- GIVEN a valid payload without `mode`
- WHEN it is posted
- THEN the response is `400`

#### Scenario: Out-of-range count is rejected

- GIVEN a valid payload with `usage.flags.total = 1000000000`
- WHEN it is posted
- THEN the response is `400`

#### Scenario: Unsupported schema version

- GIVEN a payload with `schema_version: 2`
- WHEN it is posted
- THEN the response is `400`

#### Scenario: Malformed JSON

- WHEN the body is not valid JSON
- THEN the response is `400`

#### Scenario: New SDK type from a newer Flagward is accepted

- GIVEN a valid payload with `sdks[0].type = "angular"`
- WHEN it is posted
- THEN the response is `204`

### Requirement: Size and Rate Limits at the Proxy

Nginx MUST enforce a 16 KB body limit and a per-IP rate limit before the request reaches the application.

#### Scenario: Oversized body

- WHEN a 20 KB body is posted
- THEN Nginx responds `413` and the app receives nothing

#### Scenario: Rate limit exceeded

- GIVEN one IP exceeding the configured request rate to `/v1/heartbeat`
- WHEN it keeps posting
- THEN Nginx responds `429` to the excess requests

### Requirement: Client IP Never Reaches the Application

The application MUST NOT receive, log or store the client IP.

#### Scenario: No IP headers upstream

- GIVEN a request from `203.0.113.7` with its own `X-Forwarded-For: 198.51.100.9` header
- WHEN Nginx proxies it to the app
- THEN the app sees neither address in any header

#### Scenario: No IP in logs

- GIVEN heartbeats received from known test IPs
- WHEN the Nginx access log, Nginx error log for this vhost, application logs and database are searched for those IPs
- THEN none contains them
