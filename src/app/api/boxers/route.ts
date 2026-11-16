import { requireApprovedClubApi } from '@/server/auth/guards';
import { boxerInputSchema, createBoxer } from '@/server/boxers/service';
import { ipHash, ok, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  const session = await requireApprovedClubApi(req);
  const input = await readJson(req, boxerInputSchema);
  return ok(await createBoxer(session, input, { ipHash: ipHash(req) }), { status: 201 });
});
