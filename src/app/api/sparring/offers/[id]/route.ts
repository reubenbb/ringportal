import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { attendanceSchema, decideOffer, recordAttendance } from '@/server/sparring/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

const body = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['approve', 'decline', 'withdraw']) }),
  attendanceSchema.extend({ action: z.literal('attendance') }),
]);

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Offer not found');
  const input = await readJson(req, body);
  const meta = { ipHash: ipHash(req) };
  if (input.action === 'attendance') {
    await recordAttendance(session, id.data, input, meta);
    return ok();
  }
  return ok(await decideOffer(session, id.data, input.action, meta));
});
