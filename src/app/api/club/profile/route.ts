import { requireClubApi } from '@/server/auth/guards';
import { clubProfileSchema, updateOwnProfile } from '@/server/clubs/profile';
import { ipHash, ok, readJson, route } from '@/server/http';

export const PUT = route(async (req) => {
  const session = await requireClubApi(req);
  await updateOwnProfile(session, await readJson(req, clubProfileSchema), { ipHash: ipHash(req) });
  return ok();
});
