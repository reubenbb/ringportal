import { z } from 'zod';
import { requireAdminApi } from '@/server/auth/guards';
import { clubRegionSchema, setClubRegion } from '@/server/clubs/admin';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdminApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Club not found');
  const { region } = await readJson(req, clubRegionSchema);
  await setClubRegion(admin, id.data, region, { ipHash: ipHash(req) });
  return ok();
});
