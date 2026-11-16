import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { requestSchema, setRequestStatus, updateRequest } from '@/server/shows/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };
async function requestId(ctx: Ctx) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) throw new ApiError('not_found', 'Request not found');
  return id.data;
}

export const PUT = route<Ctx>(async (req, ctx) => {
  const session = await requireApprovedClubApi(req);
  await updateRequest(session, await requestId(ctx), await readJson(req, requestSchema), { ipHash: ipHash(req) });
  return ok();
});

export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireApprovedClubApi(req);
  const { status } = await readJson(req, z.object({ status: z.enum(['open', 'closed']) }));
  await setRequestStatus(session, await requestId(ctx), status, { ipHash: ipHash(req) });
  return ok();
});
