import { connection } from 'next/server';
import { getStats } from '@/lib/stats';

export async function GET() {
  await connection();
  return Response.json(await getStats());
}
