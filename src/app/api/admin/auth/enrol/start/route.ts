import { adminEnrolmentStart } from '@/server/auth/admin-auth';
import { readSessionToken } from '@/server/auth/session';
import { ApiError, ok, route } from '@/server/http';

export const POST = route(async (req) => {
  const challenge = readSessionToken(req, 'admin_mfa');
  if (!challenge) throw new ApiError('unauthenticated', 'Your sign-in has expired. Start again.');
  return ok(await adminEnrolmentStart(challenge));
});
