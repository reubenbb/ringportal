import { z } from 'zod';
import { confirmMfaRotation } from '@/server/auth/admin-auth';
import { requireAdminApi } from '@/server/auth/guards';
import { ipHash, ok, readJson, route, userAgent } from '@/server/http';

const body = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your new authenticator') });

export const POST = route(async (req) => {
  const admin = await requireAdminApi(req);
  const { code } = await readJson(req, body);
  return ok(await confirmMfaRotation(admin, code, { ipHash: ipHash(req), userAgent: userAgent(req) }));
});
