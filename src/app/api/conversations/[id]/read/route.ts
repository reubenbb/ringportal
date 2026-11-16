import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { markRead } from '@/server/messaging/service';
import { ApiError, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Conversation not found');
  const { upToId } = await readJson(req, z.object({ upToId: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }));
  return ok(await markRead(session, id.data, upToId));
});
