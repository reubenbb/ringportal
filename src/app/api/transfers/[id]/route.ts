import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { actOnTransfer } from '@/server/transfers/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Transfer request not found');
  const { action } = await readJson(req, z.object({ action: z.enum(['approve', 'decline', 'cancel']) }));
  const { status } = await actOnTransfer(session, id.data, action, { ipHash: ipHash(req) });
  return ok({ status });
});
