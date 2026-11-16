import { z } from 'zod';
import { emailSchema } from '@/server/auth/password';
import { requestPasswordReset } from '@/server/auth/password-reset';
import { ipHash, ok, readJson, route } from '@/server/http';

const body = z.object({ email: emailSchema, audience: z.enum(['club', 'admin']).default('club') });

export const POST = route(async (req) => {
  const { email, audience } = await readJson(req, body);
  await requestPasswordReset(email, audience, { ipHash: ipHash(req) });
  // Identical response whether or not the account exists.
  return ok({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' }, { status: 202 });
});
