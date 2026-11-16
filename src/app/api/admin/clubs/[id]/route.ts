import { z } from 'zod';
import { requireAdminApi } from '@/server/auth/guards';
import { clubDecisionSchema, decideClub } from '@/server/clubs/admin';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdminApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Club not found');
  const input = await readJson(req, clubDecisionSchema);
  return ok(await decideClub(admin, id.data, input, { ipHash: ipHash(req) }));
});
