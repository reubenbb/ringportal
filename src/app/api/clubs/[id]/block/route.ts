import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { blockClub, unblockClub } from '@/server/clubs/blocks';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Club not found');
  const { blocked } = await readJson(req, z.object({ blocked: z.boolean() }));
  if (blocked) await blockClub(session, id.data, { ipHash: ipHash(req) });
  else await unblockClub(session, id.data, { ipHash: ipHash(req) });
  return ok();
});
