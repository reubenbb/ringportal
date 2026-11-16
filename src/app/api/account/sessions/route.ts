import { listClubSessions } from '@/server/auth/club-auth';
import { requireClubApi } from '@/server/auth/guards';
import { ok, route } from '@/server/http';

export const GET = route(async (req) => {
  const session = await requireClubApi(req);
  return ok({ sessions: await listClubSessions(session) });
});
