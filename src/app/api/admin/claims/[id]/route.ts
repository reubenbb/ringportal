import { z } from 'zod';
import { requireAdminApi } from '@/server/auth/guards';
import { decideClaim } from '@/server/clubs/admin';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdminApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Claim not found');
  const { approve } = await readJson(req, z.object({ approve: z.boolean() }));
  await decideClaim(admin, id.data, approve, { ipHash: ipHash(req) });
  return ok();
});
