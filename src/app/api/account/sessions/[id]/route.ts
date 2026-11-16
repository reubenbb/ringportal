import { z } from 'zod';
import { revokeClubSession } from '@/server/auth/club-auth';
import { requireClubApi } from '@/server/auth/guards';
import { ApiError, ipHash, ok, route, userAgent } from '@/server/http';

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Session not found');
  await revokeClubSession(session, id.data, { ipHash: ipHash(req), userAgent: userAgent(req) });
  return ok({ ok: true });
});
