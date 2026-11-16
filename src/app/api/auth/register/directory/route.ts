import { searchClaimable } from '@/server/clubs/registration';
import { ipHash, ok, route } from '@/server/http';

/** Public lookup of unclaimed directory records by name (names and regions only). */
export const GET = route(async (req) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 3) return ok({ items: [] });
  return ok({ items: await searchClaimable(q, { ipHash: ipHash(req) }) });
});
