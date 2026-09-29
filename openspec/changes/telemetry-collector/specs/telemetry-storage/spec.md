# Telemetry Storage Specification

## Purpose

Persist accepted heartbeats as one row per installation per day, track each installation's lifecycle, and delete raw data after the retention window.

## ADDED Requirements

### Requirement: One Heartbeat per Installation per Day

The system MUST store at most one heartbeat row per `(installation_id, UTC day of reception)`. A later heartbeat the same day MUST replace that day's payload.

The day is derived from the server's reception time, never from the client-supplied `sent_at`.

#### Scenario: First heartbeat of the day

- GIVEN no heartbeat from installation `A` today
- WHEN a valid heartbeat from `A` is accepted
- THEN one `heartbeats` row exists for `(A, today)`

#### Scenario: Second heartbeat the same day

- GIVEN a heartbeat from `A` stored today with `usage.flags.total = 2`
- WHEN another valid heartbeat from `A` arrives today with `usage.flags.total = 5`
- THEN there is still one row for `(A, today)` and its payload has `usage.flags.total = 5`

#### Scenario: Client clock is ignored

- GIVEN a heartbeat with `sent_at` three days in the past
- WHEN it is accepted
- THEN it is stored under today's UTC date

### Requirement: Installation Lifecycle

The system MUST keep one `installations` row per `installation_id` with `first_received_at`, `last_received_at`, the client-reported `first_seen_at`, and the latest accepted payload.

#### Scenario: New installation

- GIVEN installation `A` never seen before
- WHEN its first heartbeat is accepted
- THEN an `installations` row exists with `first_received_at = last_received_at = now`

#### Scenario: Returning installation

- GIVEN installation `A` first received 10 days ago
- WHEN a heartbeat is accepted today
- THEN `first_received_at` is unchanged, `last_received_at = now`, and the latest payload is today's

#### Scenario: Concurrent heartbeats from the same installation

- GIVEN two valid heartbeats from `A` arriving at the same time
- WHEN both are processed
- THEN exactly one `installations` row and one `heartbeats` row for today exist

### Requirement: Retention

The system MUST delete `heartbeats` rows older than 13 months, and `installations` whose last heartbeat is older than 13 months.

#### Scenario: Old heartbeats are removed

- GIVEN a heartbeat row dated 14 months ago
- WHEN retention runs
- THEN that row no longer exists

#### Scenario: Abandoned installation is removed

- GIVEN an installation last received 14 months ago
- WHEN retention runs
- THEN its `installations` row no longer exists

#### Scenario: Recent data is kept

- GIVEN a heartbeat row dated 12 months ago
- WHEN retention runs
- THEN it still exists
