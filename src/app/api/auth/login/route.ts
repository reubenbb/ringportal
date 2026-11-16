import { z } from 'zod';
import { clubLogin } from '@/server/auth/club-auth';
import { emailSchema } from '@/server/auth/password';
import { setSessionCookie } from '@/server/auth/session';
import { ipHash, ok, readJson, route, userAgent } from '@/server/http';

const body = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(256) });

export const POST = route(async (req) => {
  const input = await readJson(req, body);
  const token = await clubLogin(input, { ipHash: ipHash(req), userAgent: userAgent(req) });
  const res = ok({ ok: true });
  setSessionCookie(res, 'club', token);
  return res;
});
