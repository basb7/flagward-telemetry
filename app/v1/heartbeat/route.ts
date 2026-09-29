import { getDatabase } from '@/lib/db/client';
import { handleHeartbeat } from '@/lib/ingest';

// Only POST is exported, so Next.js answers any other method with 405.
export async function POST(request: Request) {
  return handleHeartbeat(request, getDatabase());
}
