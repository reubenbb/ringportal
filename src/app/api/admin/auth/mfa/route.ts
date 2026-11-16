import { z } from 'zod';
import { adminMfaStep } from '@/server/auth/admin-auth';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '@/server/auth/session';
import { ApiError, ipHash, ok, readJson, route, userAgent } from '@/server/http';

const body = z
  .object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(), recoveryCode: z.string().trim().max(32).optional() })
  .refine((b) => Boolean(b.code) !== Boolean(b.recoveryCode), { message: 'Enter a code or a recovery code', path: ['code'] });

export const POST = route(async (req) => {
  const challenge = readSessionToken(req, 'admin_mfa');
  if (!challenge) throw new ApiError('unauthenticated', 'Your sign-in has expired. Start again.');
  const input = await readJson(req, body);
  const token = await adminMfaStep(challenge, input, { ipHash: ipHash(req), userAgent: userAgent(req) });
  const res = ok({ ok: true });
  clearSessionCookie(res, 'admin_mfa');
  setSessionCookie(res, 'admin', token);
  return res;
});
