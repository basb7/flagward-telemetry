# Flagward Telemetry

The collector and public stats page behind **[telemetry.flagward.com](https://telemetry.flagward.com)**.

Self-hosted [Flagward](https://github.com/basb7/flagward) installations send one anonymous heartbeat a day (see Flagward's [`docs/telemetry.md`](https://github.com/basb7/flagward/blob/main/docs/telemetry.md) for every field and how to turn it off). This service receives those heartbeats, stores one row per installation per day, and publishes aggregates that no single installation can distort.

| Path | What |
|------|------|
| `POST /v1/heartbeat` | Ingestion. Strict schema v1; `204` on success, `400` invalid, `415` wrong content type |
| `GET /v1/stats` | Every published number, as JSON |
| `GET /en`, `/es` | The public page (same numbers, cached 15 min) |
| `GET /health` | `200` with the database, `503` without |

## Privacy guarantees

These are promises made in Flagward's docs. Any change that weakens one is a bug.

1. **The IP is never stored.** Nginx is the only component that sees it: it keeps no access log, logs errors only at `crit`, and blanks every client-IP header before proxying. The app has no code path that could receive an IP. The app port listens on loopback only.
2. **Only schema v1 is stored.** Unknown fields reject the whole payload (`400`); rejected payloads are not stored and error responses never echo values back.
3. **One installation, one vote.** Published usage is medians and percentages of installations, never sums.
4. **No small groups.** Any category with fewer than 5 installations is shown as `other`; if `other` is itself under 5 it is shown as `< 5`. Below 5 installations in total, no breakdown is published.
5. **Retention.** Heartbeats and installations are deleted 13 months after they were last received.

## Local development

Requires Node 24 and Docker.

```bash
cp .env.example .env
npm install
docker compose -f compose.dev.yml up -d          # PostgreSQL 18 on localhost:5433
docker compose -f compose.dev.yml exec db psql -U telemetry -c 'CREATE DATABASE telemetry_test'
DATABASE_URL=postgres://telemetry:telemetry@localhost:5433/telemetry node scripts/migrate.ts
npm run dev                                       # http://localhost:3000
```

Useful commands:

```bash
npm test                    # Vitest; integration tests use TEST_DATABASE_URL (migrated automatically)
npm run lint                # Biome
npm run build               # works without a database: all reads happen at request time
npm run db:generate         # new SQL migration after editing lib/db/schema.ts

# Fake established installations, so the page shows breakdowns (localhost only)
DATABASE_URL=postgres://telemetry:telemetry@localhost:5433/telemetry node scripts/seed-demo.ts

# Send a real heartbeat from a local Flagward checkout
FLAGWARD_TELEMETRY=true FLAGWARD_TELEMETRY_URL=http://localhost:3000/v1/heartbeat \
  python manage.py telemetry --send
```

`tests/fixtures/` holds real payloads produced by Flagward; regenerate them when the schema version changes.

## Deploy (same VPS and Nginx as the landing)

1. **DNS**: point `telemetry.flagward.com` at the VPS.
2. **Stack**:
   ```bash
   git clone https://github.com/basb7/flagward-telemetry && cd flagward-telemetry
   echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
   docker compose up -d --build
   ```
   `migrate` applies migrations and exits; then `app` (on `127.0.0.1:3100`) and `retention` (daily) start. Set `TELEMETRY_PORT` in `.env` to change the port — and change `deploy/nginx/…conf` to match.
3. **Nginx**:
   ```bash
   sudo cp deploy/nginx/telemetry.flagward.com.conf /etc/nginx/sites-available/telemetry.flagward.com
   sudo ln -s /etc/nginx/sites-available/telemetry.flagward.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d telemetry.flagward.com
   ```
4. **Verify** (from your machine):
   ```bash
   curl -s https://telemetry.flagward.com/health                       # {"status":"ok"}
   python manage.py telemetry --send                                    # from a Flagward checkout: HTTP 204
   ```

### Privacy check after every Nginx or deploy change

```bash
MYIP=$(curl -s https://ifconfig.me)
curl -s -X POST -H 'content-type: application/json' -d '{}' https://telemetry.flagward.com/v1/heartbeat
sudo grep -rF "$MYIP" /var/log/nginx/ && echo "IP FOUND — fix before continuing" || echo "no IP in Nginx logs"
docker compose logs app 2>&1 | grep -F "$MYIP" && echo "IP FOUND in app logs" || echo "no IP in app logs"
docker compose exec db pg_dump -U telemetry telemetry | grep -F "$MYIP" && echo "IP FOUND in database" || echo "no IP in database"
```

Note that the server-wide `access_log` in `/etc/nginx/nginx.conf` does not apply to this vhost because it sets `access_log off` itself; keep it that way.
