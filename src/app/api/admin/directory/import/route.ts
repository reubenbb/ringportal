import { requireAdminApi } from '@/server/auth/guards';
import { loadBundledDirectory } from '@/server/directory/bundled';
import { importEnglandBoxingDirectory } from '@/server/directory/import';
import { ok, route } from '@/server/http';

export const maxDuration = 60;

/** Platform owner only: (re)imports the bundled England Boxing directory. Idempotent and audited. */
export const POST = route(async (req) => {
  const admin = await requireAdminApi(req, { ownerOnly: true });
  const summary = await importEnglandBoxingDirectory(await loadBundledDirectory(), { type: 'platform_user', id: admin.platformUserId });
  return ok(summary);
});
