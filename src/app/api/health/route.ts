import { sql } from 'drizzle-orm';
import { withAuth } from '@/server/db/client';
import { ok, route } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * Liveness and database check for uptime monitors. Reveals nothing beyond up/down and the
 * deployed commit; never error details, counts or configuration.
 */
export const GET = route(async () => {
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7);
  const started = Date.now();
  try {
    await withAuth((tx) => tx.execute(sql`select 1`));
    return ok({ status: 'ok', database: 'ok', commit, ms: Date.now() - started });
  } catch (err) {
    console.error('[health] database check failed', { name: err instanceof Error ? err.name : 'unknown' });
    return ok({ status: 'degraded', database: 'unreachable', commit }, { status: 503 });
  }
});
