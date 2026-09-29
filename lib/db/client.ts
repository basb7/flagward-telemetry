import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string) {
  const sql = postgres(url, { max: 10 });
  return drizzle(sql, { schema });
}

let database: Database | undefined;

/** The process-wide database, created on first use from DATABASE_URL. */
export function getDatabase(): Database {
  if (!database) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    database = createDatabase(url);
  }
  return database;
}
