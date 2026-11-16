import { requireApprovedClubApi } from '@/server/auth/guards';
import { createSparringRequest, sparringRequestSchema } from '@/server/sparring/service';
import { ipHash, ok, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  const session = await requireApprovedClubApi(req);
  return ok(await createSparringRequest(session, await readJson(req, sparringRequestSchema), { ipHash: ipHash(req) }), { status: 201 });
});
