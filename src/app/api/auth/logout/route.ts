import { clubLogout } from '@/server/auth/club-auth';
import { clearSessionCookie, readSessionToken } from '@/server/auth/session';
import { ipHash, ok, route, userAgent } from '@/server/http';

export const POST = route(async (req) => {
  const token = readSessionToken(req, 'club');
  if (token) await clubLogout(token, { ipHash: ipHash(req), userAgent: userAgent(req) });
  const res = ok({ ok: true });
  clearSessionCookie(res, 'club');
  return res;
});
