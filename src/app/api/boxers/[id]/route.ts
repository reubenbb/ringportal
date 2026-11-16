import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { boxerInputSchema, updateBoxer } from '@/server/boxers/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route<Ctx>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Boxer not found');
  const input = await readJson(req, boxerInputSchema);
  await updateBoxer(session, id.data, input, { ipHash: ipHash(req) });
  return ok({ ok: true });
});
