import { requireApprovedClubApi } from '@/server/auth/guards';
import { openConversation, openConversationSchema } from '@/server/messaging/service';
import { ok, readJson, route } from '@/server/http';

/** Find or create a general or boxer conversation with another approved club. */
export const POST = route(async (req) => {
  const session = await requireApprovedClubApi(req);
  const input = await readJson(req, openConversationSchema);
  return ok(await openConversation(session, input));
});
