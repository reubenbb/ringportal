import { z } from 'zod';
import { listAudit } from '@/server/admin/queries';
import { requireAdminApi } from '@/server/auth/guards';
import { ApiError, ok, route } from '@/server/http';

const query = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  action: z.string().trim().max(64).regex(/^[a-z_.]*$/).optional(),
  clubId: z.uuid().optional(),
});

export const GET = route(async (req) => {
  await requireAdminApi(req);
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError('bad_request', 'Invalid filter');
  return ok(await listAudit(parsed.data));
});
