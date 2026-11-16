import { z } from 'zod';
import { changeClubPassword } from '@/server/auth/club-auth';
import { requireClubApi } from '@/server/auth/guards';
import { passwordSchema } from '@/server/auth/password';
import { ipHash, ok, readJson, route, userAgent } from '@/server/http';

const body = z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(256), newPassword: passwordSchema });

export const POST = route(async (req) => {
  const session = await requireClubApi(req);
  const input = await readJson(req, body);
  return ok(await changeClubPassword(session, input, { ipHash: ipHash(req), userAgent: userAgent(req) }));
});
