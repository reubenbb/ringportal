import { requireClubApi } from '@/server/auth/guards';
import { notificationSummary } from '@/server/messaging/service';
import { ok, route } from '@/server/http';

/** Counts only: no names, boxer details or message text, so it is safe to poll and to surface in browser notifications. */
export const GET = route(async (req) => {
  const session = await requireClubApi(req);
  return ok(await notificationSummary(session));
});
