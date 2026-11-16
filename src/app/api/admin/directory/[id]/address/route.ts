import { z } from 'zod';
import { requireAdminApi } from '@/server/auth/guards';
import { setAddressStatus } from '@/server/directory/admin';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

const body = z.object({
  action: z.enum(['verify', 'unverify']),
  note: z.string().trim().min(5, 'Say how the address was checked (at least 5 characters)').max(500),
});

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdminApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Directory club not found');
  const input = await readJson(req, body);
  await setAddressStatus(admin, id.data, input, { ipHash: ipHash(req) });
  return ok({ ok: true });
});
