/**
 * Storage for accepted heartbeats. No column anywhere holds an IP address, a
 * user agent or any request header: the app never receives the client IP
 * (Nginx strips it), and nothing else about the request is kept.
 */
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { HeartbeatV1 } from '@/lib/schema/v1';

export const installations = pgTable(
  'installations',
  {
    id: uuid('id').primaryKey(),
    // Client-reported, informational only; growth uses first_received_at.
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    firstReceivedAt: timestamp('first_received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastReceivedAt: timestamp('last_received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // Distinct UTC days with a heartbeat; >= 2 means "established".
    daysSeen: integer('days_seen').notNull().default(1),
    latest: jsonb('latest').$type<HeartbeatV1>().notNull(),
  },
  (table) => [
    index('installations_last_received_idx').on(table.lastReceivedAt),
  ],
);

export const heartbeats = pgTable(
  'heartbeats',
  {
    installationId: uuid('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    // UTC day of reception on the server; the client's sent_at is never trusted.
    day: date('day').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    payload: jsonb('payload').$type<HeartbeatV1>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.installationId, table.day] }),
    index('heartbeats_day_idx').on(table.day),
  ],
);
