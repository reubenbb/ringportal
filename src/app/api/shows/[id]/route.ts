import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { setShowStatus, showSchema, updateShow } from '@/server/shows/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };
async function showId(ctx: Ctx) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) throw new ApiError('not_found', 'Show not found');
  return id.data;
}

export const PUT = route<Ctx>(async (req, ctx) => {
  const session = await requireApprovedClubApi(req);
  await updateShow(session, await showId(ctx), await readJson(req, showSchema), { ipHash: ipHash(req) });
  return ok();
});

export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireApprovedClubApi(req);
  const { status } = await readJson(req, z.object({ status: z.enum(['scheduled', 'cancelled']) }));
  await setShowStatus(session, await showId(ctx), status, { ipHash: ipHash(req) });
  return ok();
});
