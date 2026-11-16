import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { reportConversation, reportSchema } from '@/server/reports/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Conversation not found');
  const { reason } = await readJson(req, reportSchema);
  await reportConversation(session, id.data, reason, { ipHash: ipHash(req) });
  return ok({ ok: true }, { status: 201 });
});
