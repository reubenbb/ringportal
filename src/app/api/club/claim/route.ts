import { z } from 'zod';
import { requireClubApi } from '@/server/auth/guards';
import { requestClaim } from '@/server/club/queries';
import { ipHash, ok, readJson, route } from '@/server/http';

/** Any signed-in club may request a claim; it has no effect until an administrator approves it. */
export const POST = route(async (req) => {
  const session = await requireClubApi(req);
  const { directoryClubId } = await readJson(req, z.object({ directoryClubId: z.uuid() }));
  await requestClaim(session, directoryClubId, { ipHash: ipHash(req) });
  return ok({ ok: true }, { status: 201 });
});
