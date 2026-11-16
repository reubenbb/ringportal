import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { setConversationArchived } from '@/server/messaging/service';
import { ApiError, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Conversation not found');
  const { archived } = await readJson(req, z.object({ archived: z.boolean() }));
  await setConversationArchived(session, id.data, archived);
  return ok();
});
