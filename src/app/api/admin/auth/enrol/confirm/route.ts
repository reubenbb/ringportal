import { z } from 'zod';
import { adminEnrolmentConfirm } from '@/server/auth/admin-auth';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '@/server/auth/session';
import { ApiError, ipHash, ok, readJson, route, userAgent } from '@/server/http';

const body = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const POST = route(async (req) => {
  const challenge = readSessionToken(req, 'admin_mfa');
  if (!challenge) throw new ApiError('unauthenticated', 'Your sign-in has expired. Start again.');
  const { code } = await readJson(req, body);
  const { sessionToken, recoveryCodes } = await adminEnrolmentConfirm(challenge, code, { ipHash: ipHash(req), userAgent: userAgent(req) });
  const res = ok({ recoveryCodes });
  clearSessionCookie(res, 'admin_mfa');
  setSessionCookie(res, 'admin', sessionToken);
  return res;
});
