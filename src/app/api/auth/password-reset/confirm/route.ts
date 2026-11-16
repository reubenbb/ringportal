import { z } from 'zod';
import { passwordSchema } from '@/server/auth/password';
import { confirmPasswordReset } from '@/server/auth/password-reset';
import { ipHash, ok, readJson, route } from '@/server/http';

const body = z.object({ token: z.string().min(32).max(128), password: passwordSchema });

export const POST = route(async (req) => {
  const { token, password } = await readJson(req, body);
  const audience = await confirmPasswordReset(token, password, { ipHash: ipHash(req) });
  return ok({ ok: true, audience });
});
