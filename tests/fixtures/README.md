# Fixtures

Real payloads produced by Flagward's `manage.py telemetry --show` / `--send`
(basb7/flagward, `telemetry/payload.py`), so the schema is tested against what
installations actually send, not a hand-written copy of the contract.

| File | Source |
|------|--------|
| `empty-install.json` | Fresh migrated SQLite install, no data (`mode=development`, `server=unknown`) |
| `with-sdks.json` | SQLite install seeded with flags, rules, an override, three SDK types (one unknown → `other`/`unknown`) and 150 evaluations |
| `docker-production.json` | Received by the local stub from `docker compose up` (Postgres, Redis, 4 ASGI workers) |

Regenerate them when Flagward's schema version changes.
