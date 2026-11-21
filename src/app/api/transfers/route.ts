import { requireApprovedClubApi } from '@/server/auth/guards';
import { requestTransfer, transferRequestSchema } from '@/server/transfers/service';
import { ipHash, ok, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  const session = await requireApprovedClubApi(req);
  const input = await readJson(req, transferRequestSchema);
  const { id } = await requestTransfer(session, input, { ipHash: ipHash(req) });
  return ok({ id });
});
