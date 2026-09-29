/**
 * Heartbeat ingestion and health, kept free of Next.js imports so they run
 * under Vitest against a real database. The route handlers only add
 * `connection()` and the process-wide database.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { type HeartbeatV1, heartbeatV1 } from '@/lib/schema/v1';

const NO_CONTENT = new Response(null, { status: 204 });

function jsonError(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

export async function handleHeartbeat(
  request: Request,
  db: Database,
  now: Date = new Date(),
): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return jsonError(415, { error: 'unsupported_media_type' });
  }

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return jsonError(400, { error: 'invalid_json' });
  }

  const parsed = heartbeatV1.safeParse(body);
  if (!parsed.success) {
    // Paths only: echoing values back would reflect whatever the client sent.
    const issues = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ];
    return jsonError(400, { error: 'invalid', issues });
  }

  await store(db, parsed.data, now);
  return NO_CONTENT.clone();
}

/**
 * One transaction, three statements. `xmax = 0` in RETURNING is true when the
 * row was inserted rather than updated by ON CONFLICT, which is how the upserts
 * report whether the installation and the day are new without a prior read.
 * Concurrent heartbeats from one install serialize on the conflicting rows,
 * so exactly one of them sees a new day.
 */
async function store(db: Database, payload: HeartbeatV1, now: Date) {
  const json = JSON.stringify(payload);
  // Raw `sql` params go straight to the postgres driver, which does not
  // serialize Date objects; ISO strings cast by Postgres are unambiguous.
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    const [installation] = await tx.execute<{ created: boolean }>(sql`
      INSERT INTO installations (id, first_seen_at, first_received_at, last_received_at, latest)
      VALUES (${payload.installation_id}, ${payload.first_seen_at}, ${at}, ${at}, ${json}::jsonb)
      ON CONFLICT (id) DO UPDATE
        SET last_received_at = GREATEST(installations.last_received_at, EXCLUDED.last_received_at),
            latest = EXCLUDED.latest
      RETURNING (xmax = 0) AS created
    `);

    const [heartbeat] = await tx.execute<{ new_day: boolean }>(sql`
      INSERT INTO heartbeats (installation_id, day, received_at, payload)
      VALUES (
        ${payload.installation_id},
        (${at}::timestamptz AT TIME ZONE 'UTC')::date,
        ${at},
        ${json}::jsonb
      )
      ON CONFLICT (installation_id, day) DO UPDATE
        SET received_at = EXCLUDED.received_at,
            payload = EXCLUDED.payload
      RETURNING (xmax = 0) AS new_day
    `);

    if (heartbeat.new_day && !installation.created) {
      await tx.execute(sql`
        UPDATE installations SET days_seen = days_seen + 1
        WHERE id = ${payload.installation_id}
      `);
    }
  });
}

export async function handleHealth(db: Database): Promise<Response> {
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ status: 'ok' });
  } catch {
    return jsonError(503, { status: 'unavailable' });
  }
}
