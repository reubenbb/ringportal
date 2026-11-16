import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { availabilitySchema, setAvailability } from '@/server/boxers/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Boxer not found');
  const { status } = await readJson(req, z.object({ status: availabilitySchema }));
  return ok(await setAvailability(session, id.data, status, { ipHash: ipHash(req) }));
});
