import { requireApprovedClubApi } from '@/server/auth/guards';
import { createShow, showSchema } from '@/server/shows/service';
import { ipHash, ok, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  const session = await requireApprovedClubApi(req);
  return ok(await createShow(session, await readJson(req, showSchema), { ipHash: ipHash(req) }), { status: 201 });
});
