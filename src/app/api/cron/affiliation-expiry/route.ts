import { timingSafeEqual } from 'node:crypto';
import { env } from '@/server/env';
import { runAffiliationExpiry } from '@/server/clubs/expiry';
import { ApiError, ok, route } from '@/server/http';

/** Called by Vercel Cron once a day with `Authorization: Bearer $CRON_SECRET`. */
export const GET = route(async (req) => {
  const secret = env().CRON_SECRET;
  if (!secret) throw new ApiError('forbidden', 'Scheduled jobs are not configured');
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ApiError('unauthenticated', 'Not authorised');
  const { moved } = await runAffiliationExpiry();
  console.info('[cron] affiliation-expiry', { moved: moved.length });
  return ok({ moved: moved.length });
});
