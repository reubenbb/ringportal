import { registerClub, registerSchema } from '@/server/clubs/registration';
import { setSessionCookie } from '@/server/auth/session';
import { ipHash, ok, readJson, route, userAgent } from '@/server/http';

export const POST = route(async (req) => {
  const input = await readJson(req, registerSchema);
  const token = await registerClub(input, { ipHash: ipHash(req), userAgent: userAgent(req) });
  const res = ok({ ok: true }, { status: 201 });
  setSessionCookie(res, 'club', token);
  return res;
});
