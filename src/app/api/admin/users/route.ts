import { requireAdminApi } from '@/server/auth/guards';
import { createAdminSchema, createAdminUser } from '@/server/admin/users';
import { ipHash, ok, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  const owner = await requireAdminApi(req, { ownerOnly: true });
  return ok(await createAdminUser(owner, await readJson(req, createAdminSchema), { ipHash: ipHash(req) }), { status: 201 });
});
