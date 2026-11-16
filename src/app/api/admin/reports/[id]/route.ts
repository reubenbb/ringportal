import { z } from 'zod';
import { requireAdminApi } from '@/server/auth/guards';
import { resolveReport, resolveSchema } from '@/server/reports/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdminApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Report not found');
  const { resolution } = await readJson(req, resolveSchema);
  await resolveReport(admin, id.data, resolution, { ipHash: ipHash(req) });
  return ok();
});
