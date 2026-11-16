import { requireClubApi } from '@/server/auth/guards';
import { ok, route } from '@/server/http';

export const GET = route(async (req) => {
  const s = await requireClubApi(req);
  return ok({ club: { name: s.clubName, slug: s.clubSlug, status: s.clubStatus, isDemo: s.isDemoClub }, user: { email: s.email } });
});
