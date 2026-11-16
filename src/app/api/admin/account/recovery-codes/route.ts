import { z } from 'zod';
import { regenerateRecoveryCodes } from '@/server/auth/admin-auth';
import { requireAdminApi } from '@/server/auth/guards';
import { ipHash, ok, readJson, route, userAgent } from '@/server/http';

const body = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const POST = route(async (req) => {
  const admin = await requireAdminApi(req);
  const { code } = await readJson(req, body);
  return ok({ recoveryCodes: await regenerateRecoveryCodes(admin, code, { ipHash: ipHash(req), userAgent: userAgent(req) }) });
});
