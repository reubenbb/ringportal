import { z } from 'zod';
import { adminPasswordStep } from '@/server/auth/admin-auth';
import { emailSchema } from '@/server/auth/password';
import { setSessionCookie } from '@/server/auth/session';
import { ipHash, ok, readJson, route, userAgent } from '@/server/http';

const body = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(256) });

export const POST = route(async (req) => {
  const input = await readJson(req, body);
  const { challengeToken, next } = await adminPasswordStep(input, { ipHash: ipHash(req), userAgent: userAgent(req) });
  const res = ok({ next });
  setSessionCookie(res, 'admin_mfa', challengeToken);
  return res;
});
