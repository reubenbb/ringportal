import { requireApprovedClubApi } from '@/server/auth/guards';
import { createRequest, requestSchema } from '@/server/shows/service';
import { ipHash, ok, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  const session = await requireApprovedClubApi(req);
  return ok(await createRequest(session, await readJson(req, requestSchema), { ipHash: ipHash(req) }), { status: 201 });
});
