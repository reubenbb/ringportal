import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { listMessages, messageBodySchema, sendMessage } from '@/server/messaging/service';
import { ApiError, ok, readJson, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

async function conversationId(ctx: Ctx) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) throw new ApiError('not_found', 'Conversation not found');
  return id.data;
}

const cursor = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();

/** ?after=<id> for new messages (polling), ?before=<id> for earlier ones. */
export const GET = route<Ctx>(async (req, ctx) => {
  const session = await requireApprovedClubApi(req);
  const id = await conversationId(ctx);
  const q = z.object({ before: cursor, after: cursor }).safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) throw new ApiError('bad_request', 'Invalid cursor');
  return ok(await listMessages(session, id, q.data));
});

export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireApprovedClubApi(req);
  const id = await conversationId(ctx);
  const { body } = await readJson(req, messageBodySchema);
  return ok(await sendMessage(session, id, body), { status: 201 });
});
