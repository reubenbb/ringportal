import { z } from 'zod';
import { requireAdminApi } from '@/server/auth/guards';
import { actOnAdminUser, adminUserActionSchema } from '@/server/admin/users';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const owner = await requireAdminApi(req, { ownerOnly: true });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Administrator not found');
  await actOnAdminUser(owner, id.data, await readJson(req, adminUserActionSchema), { ipHash: ipHash(req) });
  return ok();
});
