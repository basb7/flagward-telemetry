import { connection } from 'next/server';
import { getDatabase } from '@/lib/db/client';
import { handleHealth } from '@/lib/ingest';

export async function GET() {
  // Defers to request time: without it, Cache Components would try to
  // prerender this handler at build, where there is no database.
  await connection();
  return handleHealth(getDatabase());
}
