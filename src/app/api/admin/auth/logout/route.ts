import { adminLogout } from '@/server/auth/admin-auth';
import { clearSessionCookie, readSessionToken } from '@/server/auth/session';
import { ipHash, ok, route, userAgent } from '@/server/http';

export const POST = route(async (req) => {
  const token = readSessionToken(req, 'admin');
  if (token) await adminLogout(token, { ipHash: ipHash(req), userAgent: userAgent(req) });
  const res = ok({ ok: true });
  clearSessionCookie(res, 'admin');
  clearSessionCookie(res, 'admin_mfa');
  return res;
});
